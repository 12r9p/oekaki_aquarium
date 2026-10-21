# Cloudflare 運用

## 構成

- **Workers**: 画面の配信、API と画像のルーティング、エッジキャッシュ。
- **Durable Object + Container**: 既存の Bun サーバー、60fps の魚の物理演算、WebSocket 接続を単一インスタンスで実行。
- **R2**: 魚のPNGとメタデータ、設定、アップロード画像、魚の位置スナップショットを永続化。Worker binding経由で利用し、R2 APIキーをアプリに持たせない。
- **表示端末**: Workerから届く魚位置をPixi.jsで補間して描画。

Worker isolate は常駐ゲームサーバーとして使わず、Durable ObjectがCloudflare Containerの起動とルーティングを担当します。Cloudflare ContainersはLinux環境で既存アプリを実行できます。Containerのローカルディスクは再起動後に保持されないため、この構成ではR2を永続ストレージに使います。[Containers](https://developers.cloudflare.com/containers/), [Containerのライフサイクル](https://developers.cloudflare.com/containers/concepts/architecture/)

魚の座標は描画フレームごとにR2へ書き込みません。Container内のサーバーが位置を所有して60fpsでWebSocket配信し、15秒ごとに位置・速度のスナップショットだけをR2へ保存します。Containerが再起動した場合、最後のスナップショットから魚を再開します。描画端末は受け取った座標をローカルで補間します。

## 初回セットアップ

Cloudflare Containersを使うため、Workers Paidプランが必要です。Containerは稼働中のメモリ・ディスク時間とCPU使用量に応じて課金されます。水槽端末がWebSocket接続している間はContainerが稼働し続けるため、イベントでの連続稼働時間と接続台数をもとに費用を見積もってください。[Containersの料金](https://developers.cloudflare.com/containers/platform/pricing/)

Wranglerの認証が期限切れの場合は、先にCloudflareアカウントへログインします。

```sh
bunx wrangler login
```

1. Wranglerにログインします。`wrangler.jsonc` の `account_id` は今回選択した個人用Cloudflareアカウントを指定しています。

   ```sh
   bunx wrangler login
   ```

2. WranglerでR2バケットを作成します。

   ```sh
   bunx wrangler r2 bucket create oekaki-aquarium-data
   ```

3. 現在の魚・画像・水槽設定を一度だけR2へ移します。Wrangler OAuthでアップロードするため、R2 APIキーやWorker secretsは不要です。

   まず件数だけを確認します。`--dry-run` はR2へ接続せず、ファイルもアップロードしません。

   ```sh
   bun run --cwd packages/server src/r2-seed.ts --dry-run
   ```

   件数を確認した後にアップロードします。

   ```sh
   bun run --cwd packages/server src/r2-seed.ts
   ```

   このコマンドは `data/` と `packages/server/public/images/` の各ファイルをWrangler経由でR2へアップロードします。アップロードは実行時だけ行われ、デプロイ時には自動実行しません。

4. フロントエンドをビルドしてWorkerをデプロイします。

   ```sh
   bun run --cwd packages/frontend build
   bunx wrangler deploy
   ```

WranglerはDockerでContainerイメージをビルドするため、デプロイ元でDockerが利用可能である必要があります。Containerは内部Worker bridge経由でR2 bindingを呼び出し、R2 APIキーやsecretを受け取りません。ローカル開発では従来どおり `bun run dev:server` と `bun run dev:frontend` を使えます。`.dev.vars` に `AQUARIUM_ORIGIN=http://localhost:3000` がある場合、WorkerはローカルBunサーバーへ接続します。

## 永続化と位置

Cloudflare Containersのローカルディスクは停止後に初期化されるため、起動時は水槽設定、位置スナップショット、シーン画像と魚メタデータ索引だけをR2から復元します。魚1匹ごとのJSONやPNGを起動時に全件ダウンロードせず、ライブラリ一覧は約300KBの `data/fish/library-index.json` から復元し、魚PNGはWorkerがR2から直接配信してエッジキャッシュへ保存します。`r2:seed` は既存のJSONメタデータから索引を生成して一緒にアップロードします。実行中に魚のメタデータが変わると索引もR2へ反映し、SIGTERM時には保留中の書き込みをflushします。[Container FAQ](https://developers.cloudflare.com/containers/faq/)

位置スナップショットはR2の `data/fish-positions.json` に保存されます。通常の位置配信はWebSocketだけで行い、毎フレームの永続化で遅延や書き込み量を増やしません。Cloudflareが予告なくContainerを停止した場合、直近の最大15秒分の移動はスナップショットへ入らない可能性があります。

## キャッシュ

- Viteのハッシュ付きJS/CSS: 1年間 immutable。
- 魚のPNGライブラリ、魚の投稿画像、UUID付きシーン画像: R2からWorkerが直接配信し、Cache APIに最大30日。新しい画像URLはUUID/時刻付きです。
- HTML: `no-cache`。ナビゲーションごとに最新のアセット参照へ更新します。
- `/api/*`, `/ws`: `no-store`。水槽状態や待機キューを古い状態で返さないようにします。

## 運用メモ

- 魚の動きは1つの名前付きDurable Objectが所有するContainer内で一元管理します。表示端末が増えても位置の権威が分裂しません。
- Containerのスリープ・再起動時はWebSocketが切断されます。既存クライアントの再接続後に、新しい状態とフレームを配信します。
- 初回デプロイ前に `r2:seed` を実行しない場合、既存の魚、シーン画像、設定はCloudflare環境へ移りません。
- Cloudflare ContainersはContainerの実行を常時保証しません。R2に保存したファイルとスナップショットから復旧する前提です。
