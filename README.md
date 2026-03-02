# 🛍️ 雑貨屋 アイデアノート

問題・解決策・効果・Memoを管理するアイデアノートアプリ。
Google Drive連携でデータを永続保存、週1回自動バックアップ。

## セットアップ手順

### 1. Google Cloud Console設定

1. [Google Cloud Console](https://console.cloud.google.com/) を開く
2. 新しいプロジェクトを作成
3. **「APIとサービス」→「ライブラリ」** で `Google Drive API` を有効化
4. **「認証情報」→「認証情報を作成」→「OAuthクライアントID」**
   - アプリの種類: **ウェブアプリケーション**
   - 承認済みのJavaScriptオリジン: `https://あなたのNetlifyドメイン.netlify.app`（ローカル開発用に `http://localhost:3000` も追加）
   - 取得した **クライアントID** をメモ
5. **「認証情報を作成」→「APIキー」** でAPIキーを取得

### 2. app.js の設定
```js
const CONFIG = {
  CLIENT_ID: 'xxxxxxxxxx.apps.googleusercontent.com', // ← 置き換え
  API_KEY:   'AIzaSy...',                              // ← 置き換え
  FOLDER_ID: '1Z2iDVNXQpxNe3dglGVzq5HOn04ySpn4g',   // ← そのままでOK
  ...
};
```

### 3. GitHubリポジトリ作成
```bash
git init
git add .
git commit -m "Initial commit: 雑貨屋アイデアノート"
git remote add origin https://github.com/あなたのユーザー名/idea-note.git
git push -u origin main
```

### 4. Netlifyデプロイ

1. [Netlify](https://netlify.com) にログイン
2. **「Add new site」→「Import an existing project」**
3. GitHubと連携してリポジトリを選択
4. Build settings はデフォルトのままで **「Deploy」**
5. 公開されたURLをGoogle Cloud ConsoleのJavaScriptオリジンに追加

## ファイル構成
```
idea-note/
├── index.html      # メインHTML
├── style.css       # スタイル
├── app.js          # ロジック・Google Drive連携
├── netlify.toml    # Netlify設定
└── README.md       # このファイル
```

## 機能

- ✅ アイデアの追加・編集・削除
- ✅ ステータス管理（未対応 / 対応中 / 完了）
- ✅ 検索・フィルター
- ✅ Google Driveにデータ自動保存
- ✅ 週1回自動バックアップ（`ideaNote_backup_YYYY-MM-DD.json`）
- ✅ 手動バックアップボタン
- ✅ オフライン時はlocalStorageにフォールバック保存
