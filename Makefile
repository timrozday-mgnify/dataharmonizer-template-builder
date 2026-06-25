.PHONY: dev api frontend test test-compose check

api:
	uvicorn dataharmonizer_template_builder.api:app --host 127.0.0.1 --port 8765 --reload

frontend:
	npm run dev

dev:
	npm run dev -- --host 127.0.0.1

test:
	pytest

test-compose:
	./scripts/test_compose.sh

check:
	python scripts/check_repo.py
