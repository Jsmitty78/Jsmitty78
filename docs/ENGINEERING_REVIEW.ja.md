<p align="right"><a href="ENGINEERING_REVIEW.md">English</a> | <strong>日本語</strong></p>

[プロフィール](../README.ja.md) · [検証の実行手順](VERIFICATION.ja.md)

# 技術レビューの案内

ポートフォリオの実装、テスト、チームの担当を短時間で確認するためのガイドです。

<a id="start-with-sprink"></a>
## Sprinkから見る

**私が担当した実装：** イベント後のモバイルAsk画面、確認してから送信する音声入力、コンポーネントテスト、リクエストの制限、出典の文脈表示、プロバイダーのエラー処理。顧客調査、方向性の検討、ピッチで得た知見を反映しました。エージェント、計画、検証を含む全体の構成はYu Yoshimutaとのチームの成果です。

| 開くファイル | 確認する点 | 関連するテスト |
| :--- | :--- | :--- |
| [AskPanel.tsx](../projects/sprink-source/sprink/apps/web/src/workbench/ask/AskPanel.tsx) | `inflight`で重複送信を即座に防ぎ、シーケンス番号で遅れて返った回答が新しい状態を上書きしないようにしています。音声入力は自動送信せず、編集可能な下書きに入ります。 | [コンポーネントテスト15件](../projects/sprink-source/sprink/apps/web/src/workbench/ask/AskPanel.test.ts) |
| [speech.ts](../projects/sprink-source/sprink/apps/web/src/workbench/ask/speech.ts) | 認識セッションを一度だけ終了し、キャンセル時は文字を追加せず、ハンドラーを解除します。Stop後の待ち時間にも上限があります。 | [音声入力テスト12件](../projects/sprink-source/sprink/apps/web/src/workbench/ask/speech.test.ts) |
| [askErrors.ts](../projects/sprink-source/sprink/apps/web/src/workbench/ask/askErrors.ts) | 認証、タイムアウト、プロバイダーの障害ごとに復帰方法を案内します。生のサーバーエラーをそのままユーザー案内に使いません。 | [エラー変換](../projects/sprink-source/sprink/apps/web/src/workbench/ask/askErrors.test.ts)と画面のテスト |
| [サーバーのAsk処理](../projects/sprink-source/sprink/apps/server/src/sources/ask.ts) | 検索、根拠の文脈、プロバイダー障害、リクエスト制限。こちらはコードを読むための案内で、下の公開テストではバックエンドを実行しません。 | [ソースのガイド](../projects/sprink-source/README.md) |

### 設計で重視したこと

- **編集できる音声入力：** 寸法や専門用語の認識間違いを、送信前に作業者が修正できます。
- **キャンセルとリクエストの識別：** 中断するだけでは、どの回答が現在の画面に対応するかは判断できないため、シーケンス番号も確認します。
- **失敗の区別：** プロバイダーが使えない場合、検索結果がない場合、マイクを拒否した場合では、次の操作が異なります。
- **行動の前に根拠を確認：** 出典と人の確認を生成された提案から分けます。プロトタイプの結果だけで施工の適合性を判断しません。

公開テスト38件は、公開したソースの既存フロントエンドテストです。音声認識とHTTP応答は模擬であり、実際の音声認識、資料検索の品質、バックエンド全体を評価するものではありません。[コマンドと範囲](VERIFICATION.ja.md)。

### 担当した変更の記録

上流リポジトリでは、以下がJakeのGitHubアカウントによるコミットとして記録されています。個別の貢献を示すもので、全システムの単独著作を示すものではありません。このスナップショットには上流のGit履歴全体は含まれません。

| 2026年10月1日の変更 | 上流コミット |
| :--- | :--- |
| 音声入力コントローラーとエラー文言 | `52c9f94f3ee53faca2075a84d6e778d21625c16d` |
| モバイルAsk画面 | `dff66e1d1e1d3363a3db75ec93964d20d46ae124` |
| Askのコンポーネントテスト | `120f90797c2bf7d09c2104635608588f47b2fe48` |
| リクエスト制限とプロバイダー障害への対応 | `492074698afc6a661b390e455590dd1b00705621` |
| 根拠の文脈、表示権限、デモの出典 | `606be57fdbd8618d5ab62e18dd5d92d299dde1d7` |

公開スナップショットは上流コミット`7efa012b2e15f433aa39bba0fcbafeac04399d9f`を基準にしています。[マニフェスト](../projects/sprink-source/SOURCE-MANIFEST.json)に元のパスとblobハッシュを記録し、ポートフォリオの検証で306ファイルをローカルの記録ハッシュと照合します。このレビュー用の構成は、コンペ後の11月に追加しました。

## MemoryPathも見る

Yuとともに、構想、インタビュー、操作の設計、実装に取り組みました。以下は**チームの実装**の例であり、すべてのモジュールを私一人が書いたという意味ではありません。

| 技術上の問い | コードとテスト |
| :--- | :--- |
| 根拠のない引用はどう扱うか | [引用の検証](https://github.com/Jsmitty78/MemoryPath/blob/main/src/lib/verify.ts) · [提案のテスト](https://github.com/Jsmitty78/MemoryPath/blob/main/tests/proposal.test.ts) |
| 古い提案が新しいプロフィールを上書きしないか | [バージョン確認](https://github.com/Jsmitty78/MemoryPath/blob/main/src/lib/approve.ts) · [承認テスト](https://github.com/Jsmitty78/MemoryPath/blob/main/tests/approve.test.ts) |
| 提案を生成しただけで承認済み記録が変わらないか | [処理の契約テスト](https://github.com/Jsmitty78/MemoryPath/blob/main/tests/safety-contract.test.ts) |
| 任意の検索機能がない場合はどうなるか | [GBrainアダプター](https://github.com/Jsmitty78/MemoryPath/blob/main/src/lib/gbrain.ts) · [フォールバックのテスト](https://github.com/Jsmitty78/MemoryPath/blob/main/tests/safety-contract.test.ts) |

[技術ガイド](https://github.com/Jsmitty78/MemoryPath/blob/main/docs/ENGINEERING.md)に、テストで確認できることと、ローカル保存、認証、同時更新に関する制約をまとめています。

## 実機試作とチームでの完成

**[Pathway](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon)：** [当時の検出器](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon/blob/main/vision/hazard_detector.py)、[再構築したエンジン](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon/blob/main/src/pathwayEngine.js)、[テスト27件](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon/blob/main/test/hazardEngine.test.js)の順に確認できます。当時は調査、実機統合、テスト、ピッチを担当しました。[再構築メモ](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon/blob/main/docs/RECONSTRUCTION_NOTES.md)で、当時のコードと後から加えた内容を区別しています。

**[PBL4](../projects/pbl4.ja.md)：** [ベースラインとガンマ補正版](https://github.com/daitera1/PBL4-G1/tree/main/Development)を比較し、[週次の担当・引き渡し記録](https://github.com/daitera1/PBL4-G1/blob/main/Management/WEEKLY_REVIEW.md)を見ると、開発とチームの進行を確認できます。私は12人のPMと実機準備の支援を担当しました。発表と写真はチームのデモ記録であり、独立した画質ベンチマークではありません。
