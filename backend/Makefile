SHELL = cmd.exe

.PHONY: install env run dev lint format test clean help

install: ## Create venv (if needed) and install dependencies
	@if not exist .venv (python -m venv .venv)
	pip install -r requirements.txt

env: ## Copy .env.example to .env (skips if .env already exists)
	@if not exist .env (copy .env.example .env && echo [OK] .env created - add your API keys.) else (echo [SKIP] .env already exists.)

dev: ## Start FastAPI with auto-reload (requires activated venv)
	uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

run: ## Start FastAPI in production mode (requires activated venv)
	uvicorn app.main:app --host 0.0.0.0 --port 8000

lint: ## Lint with ruff
	ruff check .

format: ## Format code with ruff + black
	ruff check . --fix && black .

test: ## Run tests with pytest
	pytest -v

clean: ## Remove .venv and cached files
	@if exist .venv rmdir /s /q .venv
	@if exist .pytest_cache rmdir /s /q .pytest_cache
	@for /r . %%d in (__pycache__) do @if exist "%%d" rmdir /s /q "%%d"

help: ## Show available commands
	@echo.
	@echo   Agent Web Search - Backend
	@echo   ---------------------------
	@echo   make install   Create venv and install dependencies
	@echo   make env       Copy .env.example to .env
	@echo   make dev       Run FastAPI with auto-reload (development)
	@echo   make run       Run FastAPI (production)
	@echo   make lint      Lint with ruff
	@echo   make format    Format with ruff + black
	@echo   make test      Run tests
	@echo   make clean     Remove .venv and caches
	@echo.

.DEFAULT_GOAL := help
