# COMPLETE Terraform configuration for WIPUploader migration
# ALL 18+ CloudFormation resources included

# Resource IDs from CloudFormation stack discovery
locals {
  api_gateway_id               = "3p4utkstnb"
  upload_function_name         = "WIPUploader-UploadFunction-hJDSjvqD9eM7"
  authorizer_function_name     = "WIPUploader-AuthorizerFunction-7WKXvtdhJ2Lx"
  update_images_function_name  = "WIPUploaderUpdateImagesJsonFunction"
  upload_execution_role_name   = "WIPUploader-UploadLambdaExecutionRole-pepPv9zSfzBh"
  update_execution_role_name   = "WIPUploader-UpdateImagesJsonLambdaExecutionRole-MhwPNOwZDB5j"
  secrets_manager_arn          = "arn:aws:secretsmanager:ap-northeast-1:791464527050:secret:WIPUploaderSecret-SWNxHU"
  oac_id                       = "E1Y0EK4C9ZX47D"
  cors_policy_id              = "4f6ab204-bbcb-4a16-bb18-fb14748b8d29"
  api_resource_id             = "zu6l15"
  api_authorizer_id           = "b8w9lx"
  api_deployment_id           = "mpu16a"
}

# =====================================================================================
# SECRETS MANAGER
# =====================================================================================
resource "aws_secretsmanager_secret" "basic_auth_password" {
  name                    = "${var.stack_name}Secret"
  description             = "Password for Basic Authentication"
  recovery_window_in_days = 7

  tags = var.stack_tags
}

# Secret value managed externally via AWS CLI for security
# Use: aws secretsmanager put-secret-value --secret-id <arn> --secret-string '{"secret_key":"NEW_PASSWORD"}'
# This prevents passwords from being stored in Terraform state or code

# =====================================================================================
# S3 RESOURCES
# =====================================================================================
resource "aws_s3_bucket" "image_bucket" {
  bucket = var.image_bucket_name

  lifecycle {
    prevent_destroy = true
  }

  tags = var.stack_tags
}

resource "aws_s3_bucket_public_access_block" "image_bucket" {
  bucket = aws_s3_bucket.image_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "image_bucket" {
  bucket = aws_s3_bucket.image_bucket.id

  policy = jsonencode({
    Statement = [
      {
        Action = "s3:GetObject"
        Effect = "Allow"
        Resource = "${aws_s3_bucket.image_bucket.arn}/*"
        Principal = "*"
        Condition = {
          StringEquals = {
            "aws:SourceArn" = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${aws_cloudfront_distribution.main.id}"
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_notification" "image_bucket" {
  bucket = aws_s3_bucket.image_bucket.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.update_images_json.arn
    events              = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
    # 画像(.png)のアップロード/削除のみトリガー。images.json(.json)の書き戻しでは発火させず自己再帰を防ぐ
    filter_suffix       = ".png"
  }

  depends_on = [aws_lambda_permission.s3_invoke_update_lambda]
}

# 削除を復旧可能なソフト削除にするためバージョニングを有効化
resource "aws_s3_bucket_versioning" "image_bucket" {
  bucket = aws_s3_bucket.image_bucket.id

  versioning_configuration {
    status = "Enabled"
  }
}

# 削除（削除マーカー）と旧バージョンを一定期間後に自動で恒久削除し、無制限な蓄積を防ぐ
resource "aws_s3_bucket_lifecycle_configuration" "image_bucket" {
  bucket = aws_s3_bucket.image_bucket.id

  rule {
    id     = "expire-noncurrent-versions-and-delete-markers"
    status = "Enabled"

    filter {} # バケット内全オブジェクトに適用

    # 上書き・削除でnoncurrentになった旧バージョンを30日で恒久削除
    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    # 実体が全てnoncurrentになり残った削除マーカーを掃除
    expiration {
      expired_object_delete_marker = true
    }
  }

  depends_on = [aws_s3_bucket_versioning.image_bucket]
}

# =====================================================================================
# CLOUDFRONT RESOURCES
# =====================================================================================
resource "aws_cloudfront_origin_access_control" "image_bucket" {
  name                              = "OAC for ${var.image_bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "cors" {
  name    = "${var.stack_name}-CORS-Policy"
  comment = "CORS headers for image viewer application"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }

    access_control_allow_origins {
      items = [
        "http://localhost:*",
        "https://localhost:*",
        "http://127.0.0.1:*",
        "https://127.0.0.1:*",
        "https://kteraka.github.io",
        "https://trkoh.github.io",
        "https://odayakalife.dev"
      ]
    }

    access_control_max_age_sec = 600
    origin_override           = true
  }
}

resource "aws_cloudfront_distribution" "main" {
  comment         = "Image CDN for ${var.stack_name}"
  enabled         = true
  is_ipv6_enabled = true

  origin {
    domain_name = aws_s3_bucket.image_bucket.bucket_regional_domain_name
    origin_id   = "ImageS3Origin"

    origin_access_control_id = aws_cloudfront_origin_access_control.image_bucket.id
  }

  default_cache_behavior {
    target_origin_id       = "ImageS3Origin"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods  = ["GET", "HEAD"]

    response_headers_policy_id = aws_cloudfront_response_headers_policy.cors.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  price_class = "PriceClass_100"

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = var.stack_tags
}

# =====================================================================================
# IAM ROLES
# =====================================================================================
resource "aws_iam_role" "upload_lambda_execution" {
  name = "WIPUploader-UploadLambdaExecutionRole-pepPv9zSfzBh"  # Preserve CloudFormation name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  managed_policy_arns = [
    "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  ]

  inline_policy {
    name = "S3AccessPolicy"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect = "Allow"
          Action = [
            "s3:PutObject"
          ]
          Resource = "${aws_s3_bucket.image_bucket.arn}/*"
        }
      ]
    })
  }

  tags = var.stack_tags
}

# #16: authorizer 専用の実行ロール（upload ロール共有をやめ最小権限化）。
# 必要なのは Secrets 読み取りと自身のロググループへのログ書き込みのみ。
resource "aws_iam_role" "authorizer_lambda_execution" {
  name = "${var.stack_name}-AuthorizerLambdaExecutionRole"

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
    name = "${var.stack_name}AuthorizerPolicy"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect   = "Allow"
          Action   = ["secretsmanager:GetSecretValue"]
          Resource = aws_secretsmanager_secret.basic_auth_password.arn
        },
        {
          Effect   = "Allow"
          Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/WIPUploader-AuthorizerFunction-7WKXvtdhJ2Lx:*"
        }
      ]
    })
  }

  tags = var.stack_tags
}

resource "aws_iam_role" "update_lambda_execution" {
  name = "WIPUploader-UpdateImagesJsonLambdaExecutionRole-MhwPNOwZDB5j"  # Preserve CloudFormation name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  inline_policy {
    name = "${var.stack_name}S3AccessPolicy"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect = "Allow"
          Action = [
            "s3:ListBucket",
            "s3:GetObject",
            "s3:PutObject"
          ]
          Resource = [
            aws_s3_bucket.image_bucket.arn,
            "${aws_s3_bucket.image_bucket.arn}/*"
          ]
        },
        {
          Effect = "Allow"
          Action = [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ]
          Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/WIPUploaderUpdateImagesJsonFunction:*"
        },
        {
          Effect = "Allow"
          Action = [
            "cloudfront:CreateInvalidation"
          ]
          Resource = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${aws_cloudfront_distribution.main.id}"
        }
      ]
    })
  }

  tags = var.stack_tags
}

# =====================================================================================
# LAMBDA FUNCTIONS
# =====================================================================================
resource "aws_lambda_function" "upload" {
  function_name = "WIPUploader-UploadFunction-hJDSjvqD9eM7"  # Preserve CloudFormation name
  handler       = "index.handler"
  role         = aws_iam_role.upload_lambda_execution.arn
  runtime      = "nodejs22.x"
  timeout      = 10

  filename         = data.archive_file.upload_lambda.output_path
  source_code_hash = data.archive_file.upload_lambda.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME      = aws_s3_bucket.image_bucket.id
      CLOUDFRONT_DOMAIN = aws_cloudfront_distribution.main.domain_name
    }
  }

  tags = var.stack_tags
}

resource "aws_lambda_function" "authorizer" {
  function_name = "WIPUploader-AuthorizerFunction-7WKXvtdhJ2Lx"  # Preserve CloudFormation name
  handler       = "index.handler"
  role         = aws_iam_role.authorizer_lambda_execution.arn
  runtime      = "nodejs22.x"

  filename         = data.archive_file.authorizer_lambda.output_path
  source_code_hash = data.archive_file.authorizer_lambda.output_base64sha256

  environment {
    variables = {
      AUTH_USERNAME = var.basic_auth_username
      SECRET_ARN    = aws_secretsmanager_secret.basic_auth_password.arn
    }
  }

  tags = var.stack_tags
}

resource "aws_lambda_function" "update_images_json" {
  function_name = "WIPUploaderUpdateImagesJsonFunction"  # Preserve CloudFormation name
  handler       = "index.handler"
  role         = aws_iam_role.update_lambda_execution.arn
  runtime      = "nodejs22.x"
  timeout      = 300

  filename         = data.archive_file.update_images_lambda.output_path
  source_code_hash = data.archive_file.update_images_lambda.output_base64sha256

  environment {
    variables = {
      IMAGE_BUCKET               = var.image_bucket_name
      DISTRIBUTION_ID           = var.cloudfront_distribution_id
      IMAGES_JSON_FILENAME_PATH = var.images_json_filename_path
    }
  }

  tags = var.stack_tags
}

# No data source needed - Lambda fetches secret at runtime for security

# Lambda function ZIP files
data "archive_file" "upload_lambda" {
  type        = "zip"
  output_path = "lambda_upload.zip"
  source_dir  = "lambda-functions/upload"
}

data "archive_file" "authorizer_lambda" {
  type        = "zip"
  output_path = "lambda_authorizer.zip"
  source_dir  = "lambda-functions/authorizer"
}

data "archive_file" "update_images_lambda" {
  type        = "zip"
  output_path = "lambda_update_images.zip"
  source_dir  = "lambda-functions/update-images"
}

# =====================================================================================
# API GATEWAY
# =====================================================================================
resource "aws_api_gateway_rest_api" "main" {
  name        = "${var.stack_name}ImageUploadAPI"
  description = "Image upload API"

  tags = var.stack_tags
}

resource "aws_api_gateway_resource" "upload" {
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "upload"
  rest_api_id = aws_api_gateway_rest_api.main.id
}

resource "aws_api_gateway_authorizer" "basic_auth" {
  name            = "${var.stack_name}BasicAuthorizer"
  type            = "REQUEST"
  identity_source = "method.request.header.Authorization"
  rest_api_id     = aws_api_gateway_rest_api.main.id
  authorizer_uri  = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.authorizer.arn}/invocations"

  authorizer_result_ttl_in_seconds = 300
}

resource "aws_api_gateway_method" "upload_post" {
  http_method   = "POST"
  resource_id   = aws_api_gateway_resource.upload.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.basic_auth.id
}

resource "aws_api_gateway_integration" "upload" {
  http_method             = aws_api_gateway_method.upload_post.http_method
  resource_id             = aws_api_gateway_resource.upload.id
  rest_api_id             = aws_api_gateway_rest_api.main.id
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.upload.arn}/invocations"
}

resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  # Ensure redeployment when API changes
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.upload.id,
      aws_api_gateway_method.upload_post.id,
      aws_api_gateway_integration.upload.id,
      aws_api_gateway_authorizer.basic_auth.id,
      aws_api_gateway_resource.images.id,
      aws_api_gateway_resource.image_key.id,
      aws_api_gateway_method.image_delete.id,
      aws_api_gateway_integration.image_delete.id,
      aws_api_gateway_method.image_options.id,
      aws_api_gateway_integration.image_options.id,
      var.admin_allowed_origin, # originを変えたらプリフライト応答を再デプロイさせる
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

# #19: API Gateway アクセスログ（ブルートフォース検知・調査用）。
# アクセスログ出力にはリージョン単位で API Gateway 用 CloudWatch ロールが必要。
resource "aws_iam_role" "apigw_cloudwatch" {
  name = "${var.stack_name}-ApiGatewayCloudWatchRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "apigateway.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "apigw_cloudwatch" {
  role       = aws_iam_role.apigw_cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

# アカウント単位の設定（リージョンに1つ）。同一アカウントの他APIにもログ機能を有効化しうる点に注意。
resource "aws_api_gateway_account" "this" {
  cloudwatch_role_arn = aws_iam_role.apigw_cloudwatch.arn
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${var.stack_name}/access"
  retention_in_days = 30
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.main.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = "prod"

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId  = "$context.requestId"
      ip         = "$context.identity.sourceIp"
      method     = "$context.httpMethod"
      path       = "$context.path"
      status     = "$context.status"
      authStatus = "$context.authorizer.status"
      protocol   = "$context.protocol"
      time       = "$context.requestTime"
    })
  }

  tags = var.stack_tags

  depends_on = [aws_api_gateway_account.this]
}

# =====================================================================================
# LAMBDA PERMISSIONS
# =====================================================================================
resource "aws_lambda_permission" "api_gateway_invoke_upload" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.upload.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*/*"
}

resource "aws_lambda_permission" "api_gateway_invoke_authorizer" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  # #18: 同一アカウントの任意APIから呼べないよう、このAPIのこのauthorizerに限定
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/authorizers/${aws_api_gateway_authorizer.basic_auth.id}"
}

resource "aws_lambda_permission" "s3_invoke_update_lambda" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.update_images_json.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.image_bucket.arn
  source_account = data.aws_caller_identity.current.account_id
}

# =====================================================================================
# DELETE FEATURE (Phase 2): delete Lambda + DELETE /images/{key} + CORS preflight
# =====================================================================================
data "archive_file" "delete_lambda" {
  type        = "zip"
  output_path = "lambda_delete.zip"
  source_dir  = "lambda-functions/delete"
}

resource "aws_iam_role" "delete_lambda_execution" {
  name = "${var.stack_name}-DeleteLambdaExecutionRole"

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
    name = "${var.stack_name}DeleteS3Policy"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect   = "Allow"
          Action   = ["s3:DeleteObject"]
          Resource = "${aws_s3_bucket.image_bucket.arn}/*"
        },
        {
          Effect   = "Allow"
          Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.stack_name}-DeleteFunction:*"
        }
      ]
    })
  }

  tags = var.stack_tags
}

resource "aws_lambda_function" "delete" {
  function_name = "${var.stack_name}-DeleteFunction"
  handler       = "index.handler"
  role          = aws_iam_role.delete_lambda_execution.arn
  runtime       = "nodejs22.x"
  timeout       = 10

  filename         = data.archive_file.delete_lambda.output_path
  source_code_hash = data.archive_file.delete_lambda.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME    = aws_s3_bucket.image_bucket.id
      ALLOWED_ORIGIN = var.admin_allowed_origin
    }
  }

  tags = var.stack_tags
}

# /images
resource "aws_api_gateway_resource" "images" {
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "images"
  rest_api_id = aws_api_gateway_rest_api.main.id
}

# /images/{key}
resource "aws_api_gateway_resource" "image_key" {
  parent_id   = aws_api_gateway_resource.images.id
  path_part   = "{key}"
  rest_api_id = aws_api_gateway_rest_api.main.id
}

# DELETE /images/{key} （Basic認証はアップロードと同じカスタムオーソライザを再利用）
resource "aws_api_gateway_method" "image_delete" {
  http_method   = "DELETE"
  resource_id   = aws_api_gateway_resource.image_key.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.basic_auth.id

  request_parameters = {
    "method.request.path.key" = true
  }
}

resource "aws_api_gateway_integration" "image_delete" {
  http_method             = aws_api_gateway_method.image_delete.http_method
  resource_id             = aws_api_gateway_resource.image_key.id
  rest_api_id             = aws_api_gateway_rest_api.main.id
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.delete.arn}/invocations"
}

# OPTIONS /images/{key} （ブラウザのCORSプリフライト。認証不要のMOCK応答）
resource "aws_api_gateway_method" "image_options" {
  http_method   = "OPTIONS"
  resource_id   = aws_api_gateway_resource.image_key.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "image_options" {
  http_method = aws_api_gateway_method.image_options.http_method
  resource_id = aws_api_gateway_resource.image_key.id
  rest_api_id = aws_api_gateway_rest_api.main.id
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "image_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.image_key.id
  http_method = aws_api_gateway_method.image_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "image_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.image_key.id
  http_method = aws_api_gateway_method.image_options.http_method
  status_code = aws_api_gateway_method_response.image_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Authorization,Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.admin_allowed_origin}'"
  }

  depends_on = [aws_api_gateway_integration.image_options]
}

resource "aws_lambda_permission" "api_gateway_invoke_delete" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*/*"
}