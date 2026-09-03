.PHONY: help install dev build test docker-up docker-down db-migrate db-seed lint clean

help:
	@echo "🎬 Movie Recommendation System"
	@echo ""
	@echo "Development Commands:"
	@echo "  make install       Install all dependencies"
	@echo "  make dev           Start frontend & backend in dev mode"
	@echo "  make build         Build frontend & backend for production"
	@echo "  make test          Run all tests"
	@echo "  make lint          Lint code"
	@echo ""
	@echo "Infrastructure Commands:"
	@echo "  make docker-up     Start PostgreSQL & Redis"
	@echo "  make docker-down   Stop containers"
	@echo "  make docker-logs   View container logs"
	@echo ""
	@echo "Database Commands:"
	@echo "  make db-migrate    Run database migrations"
	@echo "  make db-seed       Seed initial film catalog"
	@echo "  make db-reset      Reset database (⚠️  deletes data)"
	@echo ""
	@echo "Utility Commands:"
	@echo "  make clean         Remove build artifacts"
	@echo "  make format        Format code"

install:
	npm install
	cd services/workers && poetry install

dev:
	npm run dev

build:
	npm run build

test:
	npm run test

lint:
	npm run lint

docker-up:
	npm run docker:up
	@echo "✅ PostgreSQL and Redis are running"
	@echo "   PostgreSQL: localhost:5432"
	@echo "   Redis: localhost:6379"

docker-down:
	npm run docker:down

docker-logs:
	docker-compose --project-directory . -f docker/docker-compose.yml logs -f

db-migrate:
	npm run db:migrate

db-seed:
	npm run db:seed

db-reset:
	@echo "⚠️  This will delete all data!"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		npm run docker:down; \
		npm run docker:up; \
		npm run db:migrate; \
		npm run db:seed; \
		echo "✅ Database reset complete"; \
	fi

clean:
	rm -rf apps/*/dist apps/*/node_modules
	rm -rf services/workers/__pycache__
	rm -rf .pnpm-store

format:
	npm run lint -- --fix
	cd services/workers && black src/ --line-length 100

.PHONY: db-reset
