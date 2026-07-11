# =====================================================================================
# U-P1 リファレンス写真基盤（Phase 2 / ADR-006）
# 写真は常に非公開。公開CDN(CloudFront)から構造的に到達不能にするため、
# 絵とは「別バケット」「別DynamoDBテーブル」に完全分離する（プレフィックス分けにしない理由:
# 既存バケットポリシーは CloudFront に /* の GetObject を許可しており、塞ぎ漏れ1箇所=漏洩のため）。
# 閲覧は photos Lambda が発行する期限付き presigned URL のみ。
# =====================================================================================

locals {
  photo_bucket_name = "${var.image_bucket_name}-photos"
}

resource "aws_s3_bucket" "photo_bucket" {
  bucket = local.photo_bucket_name

  lifecycle {
    prevent_destroy = true
  }

  tags = var.stack_tags
}

# 公開ブロックは全て有効。バケットポリシーも作らない＝アクセスは IAM（photos Lambda）経由のみ。
resource "aws_s3_bucket_public_access_block" "photo_bucket" {
  bucket = aws_s3_bucket.photo_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 削除を復旧可能にする（絵バケットと同じ運用）
resource "aws_s3_bucket_versioning" "photo_bucket" {
  bucket = aws_s3_bucket.photo_bucket.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "photo_bucket" {
  bucket = aws_s3_bucket.photo_bucket.id

  rule {
    id     = "expire-noncurrent-versions-and-delete-markers"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    expiration {
      expired_object_delete_marker = true
    }
  }

  depends_on = [aws_s3_bucket_versioning.photo_bucket]
}

# 写真メタデータ（撮影メモ等）。絵の ImageMetadata とテーブルを分けるのは、
# 公開射影(update-images の Scan→metadata.json)が写真レコードに触れる余地を消すため。
resource "aws_dynamodb_table" "photo_metadata" {
  name         = "${var.stack_name}-PhotoMetadata"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "photoId" # = <timestamp>.<ext>

  attribute {
    name = "photoId"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = var.stack_tags
}

# ---- Lambda ------------------------------------------------------------------------

resource "terraform_data" "photos_deps" {
  triggers_replace = [
    filesha256("${path.module}/lambda-functions/photos/index.js"),
    filesha256("${path.module}/lambda-functions/photos/package.json"),
    filesha256("${path.module}/lambda-functions/photos/package-lock.json"),
  ]
  provisioner "local-exec" {
    working_dir = "${path.module}/lambda-functions/photos"
    command     = "npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund"
  }
}

data "archive_file" "photos_lambda" {
  depends_on  = [terraform_data.photos_deps] # node_modules を含めるため install 後に zip
  type        = "zip"
  output_path = "lambda_photos.zip"
  source_dir  = "lambda-functions/photos"
}

resource "aws_iam_role" "photos_lambda_execution" {
  name = "${var.stack_name}-PhotosLambdaExecutionRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  inline_policy {
    name = "${var.stack_name}PhotosPolicy"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          # GetObject は presigned URL 署名者として必要（URL利用時にこのロール権限で評価される）
          Effect   = "Allow"
          Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
          Resource = "${aws_s3_bucket.photo_bucket.arn}/*"
        },
        {
          Effect   = "Allow"
          Action   = ["dynamodb:PutItem", "dynamodb:Scan", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
          Resource = aws_dynamodb_table.photo_metadata.arn
        },
        {
          Effect   = "Allow"
          Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.stack_name}-PhotosFunction:*"
        }
      ]
    })
  }

  tags = var.stack_tags
}

resource "aws_lambda_function" "photos" {
  function_name = "${var.stack_name}-PhotosFunction"
  handler       = "index.handler"
  role          = aws_iam_role.photos_lambda_execution.arn
  runtime       = "nodejs22.x"
  timeout       = 30 # 一覧は全件Scan+presign。600枚規模でも数秒だが余裕を持つ
  memory_size   = 256

  filename         = data.archive_file.photos_lambda.output_path
  source_code_hash = data.archive_file.photos_lambda.output_base64sha256

  environment {
    variables = {
      PHOTO_BUCKET   = aws_s3_bucket.photo_bucket.id
      PHOTO_TABLE    = aws_dynamodb_table.photo_metadata.name
      ALLOWED_ORIGIN = var.admin_allowed_origin
    }
  }

  tags = var.stack_tags
}

resource "aws_lambda_permission" "api_gateway_invoke_photos" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.photos.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*/*"
}

# ---- API Gateway: /photos, /photos/{key} -------------------------------------------

resource "aws_api_gateway_resource" "photos" {
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "photos"
  rest_api_id = aws_api_gateway_rest_api.main.id
}

resource "aws_api_gateway_resource" "photo_key" {
  parent_id   = aws_api_gateway_resource.photos.id
  path_part   = "{key}"
  rest_api_id = aws_api_gateway_rest_api.main.id
}

# POST /photos（アップロード。authorizer が uploader/admin 両方に許可）
resource "aws_api_gateway_method" "photos_post" {
  http_method   = "POST"
  resource_id   = aws_api_gateway_resource.photos.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.basic_auth.id
}

resource "aws_api_gateway_integration" "photos_post" {
  http_method             = aws_api_gateway_method.photos_post.http_method
  resource_id             = aws_api_gateway_resource.photos.id
  rest_api_id             = aws_api_gateway_rest_api.main.id
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.photos.arn}/invocations"
}

# GET /photos（一覧+presigned URL。authorizer が admin のみに許可）
resource "aws_api_gateway_method" "photos_get" {
  http_method   = "GET"
  resource_id   = aws_api_gateway_resource.photos.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.basic_auth.id
}

resource "aws_api_gateway_integration" "photos_get" {
  http_method             = aws_api_gateway_method.photos_get.http_method
  resource_id             = aws_api_gateway_resource.photos.id
  rest_api_id             = aws_api_gateway_rest_api.main.id
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.photos.arn}/invocations"
}

# OPTIONS /photos（ブラウザのCORSプリフライト）
resource "aws_api_gateway_method" "photos_options" {
  http_method   = "OPTIONS"
  resource_id   = aws_api_gateway_resource.photos.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "photos_options" {
  http_method = aws_api_gateway_method.photos_options.http_method
  resource_id = aws_api_gateway_resource.photos.id
  rest_api_id = aws_api_gateway_rest_api.main.id
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "photos_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.photos.id
  http_method = aws_api_gateway_method.photos_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "photos_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.photos.id
  http_method = aws_api_gateway_method.photos_options.http_method
  status_code = aws_api_gateway_method_response.photos_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Authorization,Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.admin_allowed_origin}'"
  }

  depends_on = [aws_api_gateway_integration.photos_options]
}

# PUT /photos/{key}（撮影メモ編集。admin のみ）
resource "aws_api_gateway_method" "photo_put" {
  http_method   = "PUT"
  resource_id   = aws_api_gateway_resource.photo_key.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.basic_auth.id

  request_parameters = {
    "method.request.path.key" = true
  }
}

resource "aws_api_gateway_integration" "photo_put" {
  http_method             = aws_api_gateway_method.photo_put.http_method
  resource_id             = aws_api_gateway_resource.photo_key.id
  rest_api_id             = aws_api_gateway_rest_api.main.id
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.photos.arn}/invocations"
}

# DELETE /photos/{key}（admin のみ）
resource "aws_api_gateway_method" "photo_delete" {
  http_method   = "DELETE"
  resource_id   = aws_api_gateway_resource.photo_key.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.basic_auth.id

  request_parameters = {
    "method.request.path.key" = true
  }
}

resource "aws_api_gateway_integration" "photo_delete" {
  http_method             = aws_api_gateway_method.photo_delete.http_method
  resource_id             = aws_api_gateway_resource.photo_key.id
  rest_api_id             = aws_api_gateway_rest_api.main.id
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.photos.arn}/invocations"
}

# OPTIONS /photos/{key}（CORSプリフライト）
resource "aws_api_gateway_method" "photo_key_options" {
  http_method   = "OPTIONS"
  resource_id   = aws_api_gateway_resource.photo_key.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "photo_key_options" {
  http_method = aws_api_gateway_method.photo_key_options.http_method
  resource_id = aws_api_gateway_resource.photo_key.id
  rest_api_id = aws_api_gateway_rest_api.main.id
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "photo_key_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.photo_key.id
  http_method = aws_api_gateway_method.photo_key_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "photo_key_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.photo_key.id
  http_method = aws_api_gateway_method.photo_key_options.http_method
  status_code = aws_api_gateway_method_response.photo_key_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Authorization,Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.admin_allowed_origin}'"
  }

  depends_on = [aws_api_gateway_integration.photo_key_options]
}
