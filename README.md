# Remote Browser Streaming (Express + React + WebSocket)

Puppeteer で起動したリモート Chromium を、WebSocket 経由でフロントエンドに JPEG ストリーム配信して操作するプロジェクトです。

- フロントエンド: React + Vite + Tailwind
- バックエンド: Express + ws + Puppeteer
- 通信: `GET /api/health` と `WS /ws`

## できること

- サーバー側 Chromium の画面をクライアントにストリーミング表示
- 16:9 (1280x720) のリモート画面表示
- URL 遷移 (`goto`)
- マウス操作（移動 / クリック）
- キーボード入力（押下 / 離上）
- 日本語 IME 入力（確定文字列の挿入）
- 全画面表示の切り替え
- スクロール
- ストリーム品質調整（JPEG quality / everyNthFrame）
- ダウンロード対応（サーバー保存 + クライアント取得）

## ディレクトリ構成

```text
client/   React UI (canvas 描画、操作イベント送信)
server/   Express + WebSocket + Puppeteer 制御
shared/   WS メッセージスキーマ (zod)
script/   本番ビルドスクリプト
scripts/  Chromium インストール補助
```

## セットアップ

### 1) 依存インストール

```bash
npm install
```

`postinstall` で `playwright install chromium` が実行され、Chromium の準備を試みます。

### 2) 開発起動

```bash
npm run dev
```

デフォルトは `http://localhost:5000` です（`PORT` で変更可）。

### 3) 本番ビルド / 起動

```bash
npm run build
npm start
```

## NPM Scripts

- `npm run dev`: 開発サーバー起動（Express + Vite ミドルウェア）
- `npm run build`: クライアントとサーバーを `dist/` にビルド
- `npm start`: `dist/index.cjs` を本番モード起動
- `npm run check`: TypeScript 型チェック
- `npm run install:chrome`: Chromium インストール処理を手動実行

## WebSocket 仕様（要約）

エンドポイント: `ws(s)://<host>/ws`

### Client -> Server

- `init` `{ viewport? }`
- `goto` `{ url }`
- `mouseMove` `{ x, y }`
- `mouseDown` `{ button }`
- `mouseUp` `{ button }`
- `keyDown` `{ key }`
- `keyUp` `{ key }`
- `insertText` `{ text }` (IME 確定文字列など)
- `scroll` `{ deltaX, deltaY }`
- `settings` `{ quality?, everyNthFrame? }`

### Server -> Client

- `frame` `{ data }` (base64 JPEG)
- `navigated` `{ url }`
- `error` `{ message }`
- `memory` `{ usage }`

## ダウンロード機能

- Chromium 側のダウンロード先は `BROWSER_DOWNLOAD_DIR`（既定: `.cache/downloads`）
- 一覧取得: `GET /api/downloads`
- ファイル取得: `GET /api/downloads/:name`

詳細スキーマは `shared/schema.ts` を参照してください。

## 環境変数

- `PORT`: サーバーポート（既定: `5000`）
- `NODE_ENV`: `development` / `production`
- `PUPPETEER_EXECUTABLE_PATH`: Chromium 実行ファイルパスを明示する場合に使用
- `BROWSER_USER_DATA_DIR`: Chromium プロファイル保存先（既定: `.cache/chrome-user-data`）
- `PUPPETEER_CACHE_DIR`: Puppeteer キャッシュ
- `PLAYWRIGHT_BROWSERS_PATH`: Playwright ブラウザキャッシュ
- `RENDER`: Render 環境向け分岐に使用
- `DATABASE_URL`: `drizzle.config.ts` で必須（DB 利用時）

## 既知の課題（現状）

2026-03-05 時点では `npm run check`（TypeScript 型チェック）は成功します。

## 更新コメント（日付付き）

- 2026-03-05: 現状把握を実施。ブランチは `main`（`origin/main` に対して ahead 3）、README を日付付きコメント運用に更新。

## 補足

- 現在のメイン画面は `/` のみです。
- クライアントは接続断時に自動再接続を行います。
- サーバー側では接続時に `https://google.com` へ初期遷移します。
- Chromium の Cookie / LocalStorage は `BROWSER_USER_DATA_DIR` に永続化されます。
