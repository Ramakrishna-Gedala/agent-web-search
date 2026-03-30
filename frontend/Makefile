SHELL = cmd.exe

.PHONY: install dev build preview lint clean help

install: ## Install npm dependencies
	npm install

dev: ## Start Vite dev server (proxies /api to localhost:8000)
	npm run dev

build: ## Type-check and build for production
	npm run build

preview: ## Preview the production build locally
	npm run preview

lint: ## Run ESLint
	npm run lint

clean: ## Remove node_modules and dist
	@if exist node_modules rmdir /s /q node_modules
	@if exist dist rmdir /s /q dist

help: ## Show available commands
	@echo.
	@echo   Agent Web Search - Frontend
	@echo   ----------------------------
	@echo   make install   Install npm dependencies
	@echo   make dev       Start Vite dev server
	@echo   make build     Type-check and build for production
	@echo   make preview   Preview production build
	@echo   make lint      Run ESLint
	@echo   make clean     Remove node_modules and dist
	@echo.

.DEFAULT_GOAL := help
