<p align="right"><a href="VERIFICATION.md">English</a> | <strong>日本語</strong></p>

[プロフィール](../README.ja.md) · [技術レビュー](ENGINEERING_REVIEW.ja.md)

# 公開テストの実行方法

プロフィールのリポジトリには、Sprinkのソースのスナップショットと、小さな検証用構成を収録しています。非公開の参照資料、省略した図面データセット、API認証情報を用意しなくても、公開フロントエンドのテストを実行できます。

## クローンして、一つのコマンドで検証

Node.js **22.19.0以降**とnpmを使用します。

```sh
git clone https://github.com/Jsmitty78/Jsmitty78.git
cd Jsmitty78
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

アーカイブ内の`sprink/`ではなく、リポジトリのルートで実行します。依存関係は`package-lock.json`に固定しています。ルートの[GitHub Actions](../.github/workflows/portfolio-checks.yml)でも、Node 22.19.0で同じコマンドを実行します。

## 実行する内容

| コマンド | 範囲 |
| :--- | :--- |
| `npm run check:links` | 管理対象のポートフォリオMarkdownに含まれるローカルリンクと画像。外部URL、見出しのアンカー、上流のアーカイブ文書は除外。 |
| `npm run check:snapshot` | マニフェストに記録した306ファイルのGit blobハッシュ。過去にパスを伏せたファイルは記録済みのローカルハッシュを使用。 |
| `npm test` | 既存のフロントエンドテスト5ファイル・38件。アプリの差し替えや図面データなしで、保存したソースを直接検証。 |

| テストファイル | 件数 | 確認する動作 |
| :--- | ---: | :--- |
| `ask/AskPanel.test.ts` | 15 | 文字・音声入力、重複送信、出典表示、矛盾・空の結果、失敗からの復帰、終了処理 |
| `ask/speech.test.ts` | 12 | 音声認識の対応可否、エラー、重複・途中結果、Stop、Cancel、破棄 |
| `ask/askErrors.test.ts` | 4 | 認証、タイムアウト、ネットワーク・プロバイダーのエラー文言 |
| `locale.test.ts` | 4 | 言語選択と翻訳のフォールバック |
| `workflows.test.ts` | 3 | リビジョンに応じた表示と選択 |

上のパスは`projects/sprink-source/sprink/apps/web/src/workbench/`からの相対パスです。

音声認識とfetch応答には模擬を使用しています。マイク、モデルサービス、非公開の資料ライブラリは不要です。この構成は2026年11月にポートフォリオ確認用として追加したもので、保存したアプリのソースは変更していません。

## 過去のローカル検証：2026年11月13日

| リポジトリ・確認した版 | 結果 |
| :--- | :--- |
| Sprinkスナップショット `7efa012` | **38件成功、306ファイルのハッシュ一致**。 |
| [MemoryPath](https://github.com/Jsmitty78/MemoryPath) `93a1a1a` | **58件成功**。TypeScript、lint、本番ビルド成功。Next.jsのESLintプラグイン設定に関する警告あり。 |
| [Pathway](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon) `9040ac2` | **27件成功**。`npm run check`成功。 |

当時はNode 26.5.0、npm 11.17.0を使用しました。CIでは別途Node 22/20を使用しています。件数は日付付きの確認記録です。最新の状態はワークフローと[今回の確認結果](READINESS.ja.md)を参照してください。

## 確認範囲の限界

- **Sprink：** フロントエンドの一部が対象です。アプリ全体のビルド、バックエンド、型検査、現場検証ではありません。全体の読み込みには省略した図面データが必要です。バックエンド、図面、幾何計算、PDF、アップロード、E2Eはこの検証構成の対象外です。内部のCIファイルは当時の記録で、ここではルートのワークフローだけを実行します。
- **MemoryPath：** 自動テストのモデル・音声API呼び出しは模擬です。成功しても臨床的な出力、本番のアクセス管理、同時承認を検証したことにはなりません。
- **Pathway：** 再構築したJavaScriptエンジンと合成シナリオを対象とし、人の転倒検出精度を測定していません。カメラ処理や実際の緊急連絡は検証しません。
- **PBL4：** チームのコード、写真、発表、パッケージ検証へのリンクを掲載しています。今回、新たな実機投影テストは行っていません。

スナップショットの整合性は、どのファイルをテストしたかを示します。著作者やシステム全体の正しさを保証するものではありません。
