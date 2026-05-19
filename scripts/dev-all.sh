#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
FRONTEND_DIR="${ROOT_DIR}/frontend"
BACKEND_PORT="${BACKEND_PORT:-8085}"
FRONTEND_PORT="${FRONTEND_PORT:-5176}"
DEFAULT_ES_HOST="http://127.0.0.1:9200"
ES_BACKEND_VALUE="${ES_BACKEND:-http}"
ES_HOST_VALUE="${ES_HOST:-}"
ES_CONTAINER_NAME="${ES_CONTAINER:-elasticsearch}"
if [[ "${ES_BACKEND_VALUE}" != "in_memory" && -z "${ES_HOST_VALUE}" ]]; then
  ES_HOST_VALUE="${DEFAULT_ES_HOST}"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found"
  exit 1
fi

if [[ ! -d "${VENV_DIR}" ]]; then
  python3 -m venv "${VENV_DIR}"
fi

source "${VENV_DIR}/bin/activate"

if ! python -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  python -m pip install -U pip
  python -m pip install -e "${ROOT_DIR}/backend" "uvicorn[standard]"
fi

if [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
  npm --prefix "${FRONTEND_DIR}" ci
fi

wait_for_elasticsearch() {
  local host="$1"
  local attempts="${2:-60}"
  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS "${host}/_cluster/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if [[ "${ES_BACKEND_VALUE}" != "in_memory" ]]; then
  if ! wait_for_elasticsearch "${ES_HOST_VALUE}" 1; then
    if [[ "${ES_HOST_VALUE}" == "${DEFAULT_ES_HOST}" ]] \
      && command -v docker >/dev/null 2>&1 \
      && docker info >/dev/null 2>&1 \
      && docker container inspect "${ES_CONTAINER_NAME}" >/dev/null 2>&1; then
      echo "elasticsearch is not running; starting existing container ${ES_CONTAINER_NAME}..."
      docker start "${ES_CONTAINER_NAME}" >/dev/null
      if ! wait_for_elasticsearch "${ES_HOST_VALUE}" 90; then
        echo "Elasticsearch container ${ES_CONTAINER_NAME} did not become ready at ${ES_HOST_VALUE}"
        exit 1
      fi
    elif [[ "${ES_HOST_VALUE}" == "${DEFAULT_ES_HOST}" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      echo "elasticsearch is not running; starting docker compose service..."
      docker compose -f "${ROOT_DIR}/docker-compose.yml" up -d elasticsearch
      if ! wait_for_elasticsearch "${ES_HOST_VALUE}" 90; then
        echo "Elasticsearch did not become ready at ${ES_HOST_VALUE}"
        exit 1
      fi
    else
      echo "Elasticsearch is unavailable at ${ES_HOST_VALUE}."
      echo "Start Docker Desktop and run: docker compose up -d elasticsearch"
      echo "For temporary empty dev data, run: ES_BACKEND=in_memory npm run dev:all"
      exit 1
    fi
  fi
fi

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "backend: http://127.0.0.1:${BACKEND_PORT}"
echo "frontend: http://127.0.0.1:${FRONTEND_PORT}"
if [[ "${ES_BACKEND_VALUE}" == "in_memory" ]]; then
  echo "storage: in_memory"
else
  echo "elasticsearch: ${ES_HOST_VALUE}"
fi

(
  cd "${ROOT_DIR}"
  if [[ "${ES_BACKEND_VALUE}" == "in_memory" ]]; then
    ES_BACKEND=in_memory \
    uvicorn app.main:app \
      --app-dir backend \
      --host 127.0.0.1 \
      --port "${BACKEND_PORT}" \
      --reload
  else
    ES_HOST="${ES_HOST_VALUE}" \
    uvicorn app.main:app \
      --app-dir backend \
      --host 127.0.0.1 \
      --port "${BACKEND_PORT}" \
      --reload
  fi
) &
BACKEND_PID=$!

cd "${FRONTEND_DIR}"
VITE_API_PROXY_TARGET="http://127.0.0.1:${BACKEND_PORT}" npm run dev
