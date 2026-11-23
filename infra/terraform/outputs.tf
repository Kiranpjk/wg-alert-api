output "public_ip" {
  description = "Elastic IPv4 address."
  value       = aws_eip.app.public_ip
}

output "url" {
  description = "Public HTTP URL."
  value       = "http://${aws_eip.app.public_ip}"
}
