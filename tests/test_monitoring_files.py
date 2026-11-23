import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
MONITORING = ROOT / "deploy/monitoring"


def test_prometheus_targets_and_alerts():
    config = yaml.safe_load((MONITORING / "prometheus.yml").read_text())
    assert config["global"]["scrape_interval"] == "15s"
    (job,) = config["scrape_configs"]
    assert job["job_name"] == "api"
    assert job["static_configs"] == [{"targets": ["api:8000"]}]
    (rules_file,) = config["rule_files"]
    (group,) = yaml.safe_load((MONITORING / rules_file).read_text())["groups"]
    assert group["name"]
    assert {rule["alert"]: rule["for"] for rule in group["rules"]} == {
        "ApiDown": "2m",
        "HighErrorRate": "5m",
        "SlowRequests": "10m",
    }
    assert all(rule["expr"].strip() and rule["annotations"]["summary"] for rule in group["rules"])


def test_grafana_provisioning_and_compose_mounts():
    services = yaml.safe_load((ROOT / "docker-compose.monitoring.yml").read_text())["services"]
    grafana = services["grafana"]
    assert grafana["environment"]["GF_SECURITY_ADMIN_PASSWORD"] == (
        "${GRAFANA_PASSWORD:?set GRAFANA_PASSWORD}"
    )
    (source,) = yaml.safe_load(
        (MONITORING / "provisioning/datasources/prometheus.yml").read_text()
    )["datasources"]
    (provider,) = yaml.safe_load((MONITORING / "provisioning/dashboards/default.yml").read_text())[
        "providers"
    ]
    assert source["url"] == "http://prometheus:9090"
    dashboard_dir = provider["options"]["path"]
    assert f"./deploy/monitoring/dashboards:{dashboard_dir}:ro" in grafana["volumes"]
    dashboard = json.loads((MONITORING / "dashboards/api.json").read_text())
    panels = dashboard["panels"]
    assert len(panels) == 6
    assert all(panel["datasource"]["uid"] == source["uid"] for panel in panels)
    assert all(panel["targets"][0]["expr"] for panel in panels)
