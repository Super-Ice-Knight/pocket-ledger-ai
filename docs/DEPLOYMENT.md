# 部署说明

## 本地完整版本

本地版本使用 SQLite 文件持久化，最适合作为答辩演示和源码验收版本。

## 线上演示版本

线上版本按演示级持久化处理。后端部署平台需要支持磁盘写入，否则 SQLite 文件可能在重启后重置。

## 环境变量

后端：

```env
POCKET_LEDGER_DB_PATH=backend/data/pocket_ledger.db
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_MODEL=your-model-name
```

前端：

```env
VITE_API_BASE_URL=https://your-backend.example.com
```

## GitHub 注意事项

- 不提交 `.env`。
- 不提交 SQLite 数据库文件。
- 不提交 `node_modules` 和 `.venv`。
- README 中不出现本机绝对路径。

