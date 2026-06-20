variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_profile" {
  description = "AWS profile to use"
  type        = string
  default     = "dev"
}

variable "image_bucket_name" {
  description = "S3 bucket for image storage"
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$", var.image_bucket_name))
    error_message = "Bucket name must follow S3 naming rules."
  }
}

variable "basic_auth_username" {
  description = "Username for Basic Authentication"
  type        = string
}

variable "images_json_filename_path" {
  description = "Path for JSON file that logs filenames"
  type        = string
  default     = "viewer/images.json"
}

variable "environment" {
  description = "Environment (dev/staging/prod)"
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "stack_name" {
  description = "Stack name for resource naming"
  type        = string
  default     = "WIPUploader"
}

variable "cloudfront_distribution_id" {
  description = "Existing CloudFront Distribution ID for migration"
  type        = string
}

variable "admin_allowed_origin" {
  description = "Origin allowed to call the delete API from the browser (admin gallery)"
  type        = string
  default     = "https://odayakalife.dev"
}

# Common tags for all resources
variable "stack_tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project     = "image-share-app"
    ManagedBy   = "terraform"
    Environment = "dev"
  }
}