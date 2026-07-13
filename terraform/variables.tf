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

# U2: Bedrock(タグ生成/埋め込み)設定。モデル提供リージョンや画像対応モデルIDは
# 環境により異なるため変数化(オーナーが apply 時に調整可能・断定しない)。
variable "bedrock_region" {
  # 検証済み(2026-06): Nova multimodal embeddings は us-east-1 のみ提供(東京に無い)。
  # Claude 3 Haiku(vision) も us-east-1 でオンデマンド可。両モデルが揃う us-east-1 を既定とする。
  # Lambda 本体は東京、Bedrock呼び出しのみクロスリージョンで us-east-1(非同期なのでレイテンシ影響なし)。
  description = "Region for Bedrock model invocation. Default us-east-1: Nova multimodal embeddings is only available there; Claude 3 Haiku (vision) is also on-demand there."
  type        = string
  default     = "us-east-1"
}

variable "bedrock_embed_model_id" {
  description = "Bedrock model id for multimodal image embeddings (ADR-002: Nova)"
  type        = string
  default     = "amazon.nova-2-multimodal-embeddings-v1:0"
}

variable "bedrock_tag_model_id" {
  # 履歴:
  # - 2026-06 実機検証: Claude 3 Haiku=Legacy化で不可 / Claude 3.5系=EOL /
  #   Claude 4.5系=active だが Anthropic 用途フォーム提出が必須(オーナーのコンソール操作)。
  #   → 提出不要で即動作の Nova Lite を暫定採用。
  # - 2026-07 オーナー裁定: タグ精度不足のため Nova Pro へ格上げ(同じAmazonファミリー=フォーム不要・
  #   同じ messages-v1 形式・IAMは foundation-model/* 許可済みで変更不要)。≈$0.003/枚(新規分のみ)。
  # さらに精度が欲しい場合: 用途フォーム提出後に us.anthropic.claude-haiku-4-5-20251001-v1:0 等へ
  # 差し替え可能。enrich は model id 接頭辞で body 形式を分岐する。
  description = "Bedrock model id for Japanese tag generation. MUST be vision-capable. Default amazon.nova-pro-v1:0 (no Anthropic use-case form, image-capable). For Claude, submit the Anthropic use-case form and set a us.* inference-profile id."
  type        = string
  default     = "amazon.nova-pro-v1:0"
}

variable "embedding_dimension" {
  description = "Nova embedding output dimension (256|384|1024|3072). Smaller keeps the public search JSON light."
  type        = number
  default     = 1024
}

# Common tags for all resources
variable "stack_tags" {
  description = "Common tags for all resources"
  type        = map(string)
  # Must match the applied tags in state, otherwise CI (which has no local
  # terraform.tfvars) would strip tags the local apply set — causing a
  # local<->CI drift flip-flop. Keep in sync with terraform.tfvars stack_tags.
  default = {
    Project     = "image-share-app"
    ManagedBy   = "terraform"
    Environment = "dev"
    Migration   = "from-cloudformation"
  }
}