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


## Render へのデプロイ方法

### 前提

- Render のアカウント作成と課金設定
- GitHub 連携（このリポジトリを Render から参照できる状態）

### 方法A: Blueprint（`render.yaml`）を使う（推奨）

1. Render ダッシュボードで **New +** → **Blueprint** を選択
2. このリポジトリを選択
3. `render.yaml` が検出されたら内容を確認して作成
4. 初回デプロイ完了後、必要に応じて `PUPPETEER_EXECUTABLE_PATH` を環境変数に追加

この設定では以下が自動構成されます。

- Build: `npm ci && npm run build`
- Start: `npm start`
- Health Check: `/api/health`
- 無料枠向け設定: `/tmp` 配下を使用（再デプロイ/再起動で消える）

### 方法B: 手動で Web Service を作る

1. **New +** → **Web Service**
2. Runtime: Node
3. Build Command: `npm ci && npm run build`
4. Start Command: `npm start`
5. Health Check Path: `/api/health`
6. （無料枠）Persistent Disk は使えないため `/tmp` を使用
7. 環境変数を設定
   - `NODE_ENV=production`
   - `BROWSER_USER_DATA_DIR=/tmp/chrome-user-data`
   - `BROWSER_DOWNLOAD_DIR=/tmp/downloads`
   - `PUPPETEER_CACHE_DIR=/tmp/puppeteer-cache`
   - `PLAYWRIGHT_BROWSERS_PATH=/tmp/ms-playwright`

### デプロイ後の確認

- `GET /api/health` が `{"status":"ok"}` を返すこと
- 画面を開いて `/ws` 接続が `connected` になること
- 無料枠では再起動/再デプロイ後にダウンロードファイルが消えること（仕様どおり）


### 無料枠での注意点

- スリープ復帰時に初回接続が遅くなることがあります。
- `/tmp` 配下は永続化されないため、Chromeプロファイル/ダウンロード/キャッシュは消えます。
- 長時間・高負荷のストリーミング用途では有料プランより不安定になりやすいです。
