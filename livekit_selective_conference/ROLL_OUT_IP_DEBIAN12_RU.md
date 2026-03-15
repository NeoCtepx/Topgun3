# Production rollout без домена (по IP) для Debian 12

Этот документ адаптирован под ваши данные:

- ОС сервера: **Debian 12 x64**
- IP сервера: **185.219.7.21**
- Пользователь: **root**
- LiveKit URL: **wss://personzroomz-a7chety0.livekit.cloud**
- LiveKit API Key: **APINinpPDDpi7VR**

> Важно по безопасности: API Secret не храните в git. Держите только в `.env` на сервере.

---

## 0) Подключение к серверу

```bash
ssh root@185.219.7.21
```

---

## 1) Установка Docker и Docker Compose (Debian 12)

```bash
apt update
apt install -y ca-certificates curl gnupg lsb-release

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker --version
docker compose version
```

---

## 2) Размещение проекта на сервере

```bash
mkdir -p /opt/selective-conference
cd /opt/selective-conference
# Вариант A: git clone
# git clone <YOUR_REPO_URL> .

# Вариант B: если уже есть архив/файлы — скопируйте сюда.
```

В каталоге должны быть:

- `docker-compose.yml`
- `livekit_selective_conference/` (с `Dockerfile`, `app.py`, и т.д.)
- `.env.example`

---

## 3) Подготовка `.env` с вашими LiveKit данными

```bash
cd /opt/selective-conference
cp .env.example .env
```

Откройте файл:

```bash
nano .env
```

Заполните так:

```dotenv
LIVEKIT_API_KEY=APINinpPDDpi7VR
LIVEKIT_API_SECRET=<ВАШ_API_SECRET_ИЗ_LIVEKIT>
```

Сохраните и ограничьте доступ:

```bash
chmod 600 .env
```

---

## 4) Запуск API

```bash
cd /opt/selective-conference
docker compose up -d --build
```

Проверки:

```bash
docker compose ps
docker compose logs --tail=100 selective-conference-api
curl http://127.0.0.1:8000/health
```

Ожидаемо:

```json
{"ok": true}
```

---

## 5) Открыть доступ по IP (без домена)

Сейчас сервис будет доступен как:

- `http://185.219.7.21:8000/health`
- `http://185.219.7.21:8000/token`
- `http://185.219.7.21:8080` (веб-интерфейс участников)

Если используете firewall (рекомендуется), откройте только нужный порт:

```bash
apt install -y ufw
ufw allow 22/tcp
ufw allow 8000/tcp
ufw allow 8080/tcp
ufw --force enable
ufw status
```

---

## 6) Тест выдачи токена

С вашего ПК или сервера:

```bash
curl -X POST http://185.219.7.21:8000/token \
  -H 'Content-Type: application/json' \
  -d '{
    "room_name": "private-video-room",
    "participant_id": "P1",
    "group_map": {
      "P1": ["U1", "U2", "U3"],
      "P2": ["U4", "U5", "U6"],
      "P3": ["U7", "U8", "U9"],
      "P4": ["U10", "U11", "U12"]
    }
  }'
```

Если всё корректно — получите JSON с `token`.

---

## 7) Подключение клиента к LiveKit Cloud

В клиенте используйте ваш LiveKit URL:

- `wss://personzroomz-a7chety0.livekit.cloud`

Поток:

1. Клиент запрашивает токен с вашего API (`/token`).
2. Подключается к `wss://personzroomz-a7chety0.livekit.cloud` с этим токеном.
3. На клиенте применяете правило:
   - аудио — от всех;
   - видео — только из `visible_video_participants` в metadata.

---

## 8) Важно для режима «без домена»

- Для вашего token API будет **HTTP по IP** (без TLS).
- Это допустимо только как временный этап запуска.
- Для production лучше перейти на HTTPS (обычно через домен + reverse proxy).

---

## 9) Быстрая подготовка сервера одной командой

Из репозитория на вашей локальной машине можно запустить:

```bash
./scripts/prepare_server_via_ssh.sh <REPO_URL>
```

Скрипт выполнит установку Docker/Compose и базовую подготовку Debian 12 по SSH.

---

## 10) Базовые команды эксплуатации

Перезапуск:

```bash
cd /opt/selective-conference
docker compose restart
```

Обновление после git pull:

```bash
cd /opt/selective-conference
git pull
docker compose up -d --build
```

Остановка:

```bash
cd /opt/selective-conference
docker compose down
```
