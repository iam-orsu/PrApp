.PHONY: help build start stop restart logs test deploy

help:
	@echo "PR Summary GitHub App - Development Commands"
	@echo ""
	@echo "Available commands:"
	@echo "  make build         - Build the application"
	@echo "  make start         - Start Docker containers"
	@echo "  make stop          - Stop Docker containers"
	@echo "  make restart       - Restart Docker containers"
	@echo "  make logs          - View application logs"
	@echo "  make test          - Run tests"
	@echo "  make deploy        - Run deployment script"
	@echo "  make cert          - Obtain SSL certificate"
	@echo "  make clean         - Remove containers and volumes"
	@echo "  make db-backup     - Backup database"
	@echo "  make db-logs       - View database logs"

build:
	npm run build

start:
	docker-compose up -d

stop:
	docker-compose down

restart:
	docker-compose restart

logs:
	docker-compose logs -f app

logs-all:
	docker-compose logs -f

logs-db:
	docker-compose logs -f postgres

logs-nginx:
	docker-compose logs -f nginx

test:
	npm test

deploy:
	./deploy.sh

cert:
	sudo ./obtain-cert.sh

clean:
	docker-compose down -v

db-backup:
	docker-compose exec postgres pg_dump -U pr_app pr_summary_db > backup-$$(date +%s).sql

db-logs:
	docker-compose logs postgres

health:
	curl http://localhost:3000/health || true
	@echo ""
	docker-compose ps

ps:
	docker-compose ps

shell-app:
	docker-compose exec app sh

shell-db:
	docker-compose exec postgres psql -U pr_app -d pr_summary_db

migrate:
	docker-compose exec app npm run migrate
