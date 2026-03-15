# LiveKit SDK реализация: селективное видео + общий аудио канал

Это MVP-реализация вашего сценария в **одной комнате LiveKit**:

- аудио: все слышат всех (`all -> all`);
- видео: каждый «основной» участник получает только свой приватный набор видео-потоков.

## Что внутри

- `livekit_selective_conference/visibility.py` — валидация и построение правил видимости.
- `livekit_selective_conference/livekit_service.py` — создание JWT через LiveKit SDK + запись правил в metadata токена.
- `livekit_selective_conference/app.py` — API endpoint `/token` для выдачи токена конкретному участнику.
- `livekit_selective_conference/Dockerfile` — контейнеризация API для деплоя.
- `livekit_web_ui/` — готовый React веб-интерфейс на LiveKit Client SDK.
- `scripts/prepare_server_via_ssh.sh` — скрипт первичной подготовки Debian 12 сервера по SSH.

## Отдельный гайд: rollout по IP без домена

См. пошаговый файл: `livekit_selective_conference/ROLL_OUT_IP_DEBIAN12_RU.md`.

## Где хостится веб-интерфейс

В текущей конфигурации веб-интерфейс хостится **на том же сервере**, что и API:

- API: `http://<SERVER_IP>:8000`
- Web UI: `http://<SERVER_IP>:8080`

Т.е. для вашего сервера: `http://185.219.7.21:8080`.

## Быстрый запуск (Docker Compose)

### 1) Подготовить окружение

```bash
cd /workspace/AiSoftware
cp .env.example .env
# затем отредактировать .env и проставить реальные LIVEKIT_API_KEY/LIVEKIT_API_SECRET
```

### 2) Поднять API + Web UI

```bash
docker compose up -d --build
```

### 3) Проверить сервисы

```bash
docker compose ps
docker compose logs --tail=100 selective-conference-api
docker compose logs --tail=100 selective-conference-web
curl http://localhost:8000/health
```

### 4) Открыть интерфейс

- локально: `http://localhost:8080`
- по IP сервера: `http://185.219.7.21:8080`

### 5) Остановить

```bash
docker compose down
```


## Админ-панель и личные ссылки

В интерфейсе есть админ-панель, где администратор:

- задаёт режим видимости: **разрешить только список** или **видеть всех, кроме списка**;
- генерирует личную ссылку для участника;
- авторизуется по логину/паролю (Basic Auth).

Backend endpoint: `POST /admin/invite` (требует `ADMIN_USERNAME` и `ADMIN_PASSWORD`).

Обязательные переменные:

```bash
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="<strong-random-password>"
export PUBLIC_WEB_BASE_URL="http://185.219.7.21:8080"
```

Пользовательская панель ввода параметров скрыта: участник заходит только по личной ссылке.

## Как выглядит интерфейс для участников

1. Администратор открывает страницу без параметров (`http://<IP>:8080`) и входит в админ-панель по логину/паролю.
2. Администратор генерирует личную ссылку для участника.
3. Участник открывает только личную ссылку вида `http://<IP>:8080/?invite=...`.
4. Участник видит экран конференции и кнопку подключения, без ручного редактирования правил.
5. После подключения участник слышит всех, но видит только разрешённые видео.

## Скрипты подготовки сервера по SSH

### Bash (Linux/macOS)

```bash
./scripts/prepare_server_via_ssh.sh <REPO_URL>
```

### PowerShell (Windows)

```powershell
./scripts/setup_server.ps1 -RepoUrl <REPO_URL> -LiveKitApiSecret <YOUR_SECRET>
# private GitHub repo example:
./scripts/setup_server.ps1 -RepoUrl <REPO_URL> -GitHubToken <GITHUB_PAT> -LiveKitApiSecret <YOUR_SECRET>
# force clean non-git app directory before clone:
./scripts/setup_server.ps1 -RepoUrl <REPO_URL> -ForceReclone -LiveKitApiSecret <YOUR_SECRET>
```

> For private GitHub repositories over HTTPS, pass `-GitHubToken` to setup script.
> If app directory is non-empty and not a git repo, script stops by default; use `-ForceReclone` to clean directory and clone.


PowerShell script performs full bootstrap in English output (including ADMIN_USERNAME/ADMIN_PASSWORD in .env):

> If you run on Windows PowerShell, use `scripts/setup_server.ps1` from repository root and ensure file is saved in UTF-8.
> The script now normalizes line endings before sending commands to Linux to avoid `set -euo pipefail` parse errors.

> Note: the setup script opens several separate SSH sessions (bootstrap, git sync, env, firewall, compose, checks).
> If SSH key-based auth is not configured, password prompt can appear multiple times.

- installs Docker + Docker Compose plugin;
- prepares `/opt/selective-conference`;
- clones/updates repository (if `-RepoUrl` provided);
- writes `.env` with LiveKit settings;
- opens firewall ports 22/8000/8080;
- runs `docker compose up -d --build` and health check.


### Troubleshooting: private GitHub clone fails with "Invalid username or token"

- Ensure `-GitHubToken` is a valid PAT with access to the private repo.
- For classic PAT: enable at least `repo` scope.
- For fine-grained PAT: grant repository access to `Zoomzoob` and permissions for repository contents (read).
- If clone/auth step fails, setup script now stops immediately with non-zero exit code.

## Важно для режима «без домена»

- Интерфейс и API работают по HTTP/IP (без TLS).
- Это ок как быстрый старт, но для production лучше перейти на HTTPS.

## Масштаб до 32 участников

- Просто расширяете `group_map`.
- Ограничение — вычислительные ресурсы SFU и качество сети, не логика правил.


### Почему ошибка "ADMIN_USERNAME/ADMIN_PASSWORD are not configured"

Если видите эту ошибку, значит контейнер API запущен без нужных переменных окружения.

Проверьте:

1. Вы изменили именно `.env` рядом с `docker-compose.yml` (а не только `.env.example`).
2. В `.env` есть `ADMIN_USERNAME` и `ADMIN_PASSWORD`.
3. После изменений перезапустили сервисы:

```bash
docker compose down
docker compose up -d --build
```

4. Убедитесь, что переменные попали в контейнер:

```bash
docker compose exec selective-conference-api env | grep ADMIN_
```
