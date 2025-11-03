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
    events              = ["s3:ObjectCreated:*"]
  }

  depends_on = [aws_lambda_permission.s3_invoke_update_lambda]
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
        "https://trkoh.github.io"
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
        },
        {
          Effect = "Allow"
          Action = [
            "secretsmanager:GetSecretValue"
          ]
          Resource = aws_secretsmanager_secret.basic_auth_password.arn
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
          Resource = "arn:aws:logs:*:*:*"
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
  role         = aws_iam_role.upload_lambda_execution.arn
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
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.main.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = "prod"

  tags = var.stack_tags
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
}

resource "aws_lambda_permission" "s3_invoke_update_lambda" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.update_images_json.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.image_bucket.arn
  source_account = data.aws_caller_identity.current.account_id
}