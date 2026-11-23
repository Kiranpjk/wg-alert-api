# AWS single-node deployment

One x86_64 EC2 instance runs the web dashboard, API and PostgreSQL under Docker
Compose. The web container publishes port 80 and proxies `/api/` to the API.
The security group allows inbound HTTP and HTTPS from any IPv4 address. The
stack serves HTTP only and has no TLS termination yet. This is a single node
and has no high availability. PostgreSQL's named volume lives on the instance's
encrypted root disk. Back up the database before any change that replaces the
instance, including an update to the resolved AL2023 AMI.

## Validate

From this directory, using Terraform 1.10.5:

```sh
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

These checks passed locally. No plan or apply ran against a real AWS account.
The rendered bootstrap script passed `bash -n`. Instance startup and container
pulls have no runtime verification.

## Deploy

Use AWS credentials for a region with a default VPC and public default subnets.
Both GHCR images must be publicly pullable at the tags in `compose.yaml`.
Set `allowed_cidr` to your administrator network and use your own public SSH key.

```sh
terraform init
terraform plan -var 'allowed_cidr=203.0.113.10/32' \
  -var "ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"
terraform apply -var 'allowed_cidr=203.0.113.10/32' \
  -var "ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"
terraform output -raw url
```

Replace the example CIDR before deployment. Bootstrap generates the PostgreSQL
password and ingest key on the instance in root-only `/opt/wg-alert/.env`.
Use SSH as `ec2-user` from the allowed CIDR to inspect `sudo cloud-init status --long`
and retrieve the ingest key from that file for the dashboard's Settings.
Terraform outputs only the public IP and HTTP URL. The application's search
endpoints are publicly accessible through the web proxy.
