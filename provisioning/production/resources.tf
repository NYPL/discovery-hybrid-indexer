provider "aws" {
  region     = "us-east-1"
}

terraform {
  # Use s3 to store terraform state
  backend "s3" {
    bucket  = "nypl-travis-builds-production"
    key     = "discovery-hybrid-indexer-terraform-state"
    region  = "us-east-1"
  }
}

module "base" {
  source = "../base"

  environment = "production"

  vpc_config = {
    subnet_ids         = ["subnet-59bcdd03", "sg-116eeb60"]
    security_group_ids = ["sg-116eeb60"]
  }
}
