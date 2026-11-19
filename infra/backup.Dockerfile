FROM postgres:16-alpine
RUN apk add --no-cache aws-cli
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
# Runs once at 02:30 IST (21:00 UTC) every day.
CMD ["sh", "-c", "echo '0 21 * * * /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1' | crontab - && crond -f -l 8"]
