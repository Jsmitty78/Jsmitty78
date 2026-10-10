# テスト方針

画面操作、公開 API、CLI、ダウンロードした成果物から確認できる振る舞いは E2E で検証する。計算、変換、表示、入力保持の unit テストは重複して維持しない。境界値が多い、実行が速いという理由だけでは unit テストを残さない。

unit テストを残すのは、公開境界から入力・観測できず、内部の状態や依存への注入が必要な場合に限る。現状の例外は次のとおり。

- `apps/server/test/semantic.test.ts`: JEV に送る原文・識別子、要求サイズと同時実行数、不正なサービス応答の注入。
- `packages/workflow/test/choice.test.ts`: 外部サービスの不正な確率分布・型・版、不正 JSON、HTTP エラー、内部の AbortSignal と送信内容。
- `packages/workflow/test/llm-stream.test.ts`: provider のストリーム失敗、不正な tool call、途中の tool result の受け渡し、最終応答失敗。
- `packages/workflow/test/workflow.test.ts` 内の故障注入: abort を無視した遅延応答、commit の拒否・no-op、例外、内部イベントと実行回数。実際の Pi Agent を使う結合テストも同じファイルにある。
- `apps/server/test/exports.test.ts` 内の内部状態検証: producer の版更新漏れ、描画中の変更、破損した保存ファイル、公開 API が受け付けない壊れた生成 snapshot。

API・DB・ファイル・実デコーダー・実 Agent を使う既存の結合テストと、子プロセスを起動する CLI テストは維持する。これらをブラウザー E2E と呼び替えない。

## 実行と現在の範囲

`pnpm test` は残した Vitest テスト、`pnpm typecheck` は型検査を実行する。

ブラウザー E2E は `scripts/e2e-ask-uploads.mjs`。起動済みサーバー、アプリ用の `E2E_TOKEN`、Playwright と Chromium が必要。詳細はスクリプト冒頭を参照する。`pnpm replay` は起動済みサーバーへ実 HTTP リクエストを送る旧カメラワークフローの確認。

ブラウザー E2E の現状は主に Ask Sprink のアップロード、OCR レビュー、索引、回答・引用、再試行、再読み込み、モバイル表示。unit テストを削除した図面トレース、入力の provenance、製品変更、幾何・加工計算の全ケースが既存 E2E に移植済みという意味ではない。今後それらの回帰ケースは公開境界で追加する。
