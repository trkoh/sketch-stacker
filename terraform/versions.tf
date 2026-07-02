terraform {
  required_version = ">= 1.5" # For config-driven imports

  # Remote state in S3 so the same state is shared from the Mac, remote
  # containers, or CI. Terraform 1.10+ native S3 locking (use_lockfile) means
  # no separate DynamoDB lock table is needed. Credentials resolve via the
  # standard AWS chain (AWS_PROFILE=dev locally, OIDC role in CI).
  backend "s3" {
    bucket       = "sketch-stacker-tfstate-791464527050"
    key          = "sketch-stacker/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70" # Latest features
    }
    # Backup for coverage gaps
    awscc = {
      source  = "hashicorp/awscc"
      version = "~> 1.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}