variable "region" {
  description = "AWS region with a default VPC and public default subnets."
  type        = string
  default     = "eu-central-1"
}

variable "instance_type" {
  description = "x86_64 EC2 instance type."
  type        = string
  default     = "t3.small"
}

variable "allowed_cidr" {
  description = "Administrator IPv4 CIDR for SSH, for example your public IP with /32."
  type        = string

  validation {
    condition     = try(cidrnetmask(var.allowed_cidr) != "0.0.0.0", false)
    error_message = "Supply a valid IPv4 CIDR narrower than /0."
  }
}

variable "ssh_public_key" {
  description = "OpenSSH public key for the ec2-user account."
  type        = string
}
