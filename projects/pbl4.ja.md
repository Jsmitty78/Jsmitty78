<p align="right"><a href="pbl4.md">English</a> | <strong>日本語</strong></p>

[プロフィールへ](../README.ja.md) · [チームのリポジトリ](https://github.com/daitera1/PBL4-G1)

# PBL4 · 複数プロジェクターの映像合成

**2台の映像を一つのワイド映像につなぐ。12人のチームで、その開発を完成まで進める。**

立命館大学 · PBL4 Group 1 · 最終引き渡し：2026年11月12日

![チームが撮影した2台のプロジェクターによる投影結果](https://raw.githubusercontent.com/daitera1/PBL4-G1/main/Documentation/final-deliverable-2026-11-12/real.JPG)

*チームの最終資料に収録した実機写真。*

**概要：** メンバー12人 · 3部門 · 2種類の画像処理実装 · 2026年11月12日に最終引き渡し。

## プロジェクトについて

隣り合う2台のプロジェクターに表示する画像を準備するPythonアプリケーションを開発しました。それぞれが画像の左側・右側を映し、中央には重なる領域を設けます。その重なりの明るさを、ガンマ補正を含むアルファマスクで調整します。

リポジトリには、比較用に**ガンマ補正なしのベースラインと、ガンマ補正ありの2種類の実装**を収録しています。サンプル入力、設定、UML図、技術資料、発表スライド、チームの活動記録もまとめています。

**使用技術：** Python、OpenCV、NumPy、JSON設定、UML/Astah、Doxygen、Jira。

## 私の担当

**プロジェクトマネージャー**として、開発・ドキュメント・管理の3部門、12人の進行を調整しました。

- **チームの調整：** 担当を割り振り、部門リーダーと進捗を確認し、作業間の依存関係を整理しました。
- **共通の作業環境：** Jiraのタスク、日程、連絡、共有ファイルを整理し、部門間で協力しやすくしました。
- **実機の準備：** 授業中に開発チームのプロジェクター設置を手伝いました。
- **引き渡し：** 部門ごとのレビューと資料一覧を整理し、コード、技術資料、発表、管理記録をまとめて確認できるようにしました。

画像処理の実装はチームの成果です。私の中心的な役割は、プロジェクトのリード、調整、実機準備の支援、成果物の引き渡しでした。

[週次のチーム記録](https://github.com/daitera1/PBL4-G1/blob/main/Management/WEEKLY_REVIEW.md) · [私の調整計画](https://github.com/daitera1/PBL4-G1/blob/main/Management/planning/Jake-Week-3-Coordination-Plan.md) · [部門レビューの担当](https://github.com/daitera1/PBL4-G1/blob/main/Management/jira/issues/PG1-41.md)

## ソフトウェアの構成

| 段階 | 処理 |
| :--- | :--- |
| 設定 | 画像、投影する側、重なり幅、ガンマ値を読み込む。 |
| 切り出し | 元画像から左側または右側を準備する。 |
| マスク生成 | 投影する側に合わせ、重なり部分を徐々に暗くするマスクを生成する。 |
| 合成 | ベースラインまたはガンマ補正ありの実装でマスクを適用する。 |
| 表示 | OpenCVの全画面ウィンドウで出力を表示する。 |

実行するプログラムは`Development/`にあり、`main.py`から起動します。資料内のクラスのひな型は設計説明用です。[セットアップガイド](https://github.com/daitera1/PBL4-G1/blob/main/Documentation/setup.md)に、完成版のプログラムと実行コマンドをまとめています。

## 成果物を見る

| 成果物 | リンク |
| :--- | :--- |
| ソースコードと実行手順 | [Development](https://github.com/daitera1/PBL4-G1/tree/main/Development) |
| 最終技術資料と実機写真 | [資料の概要](https://github.com/daitera1/PBL4-G1/blob/main/Documentation/FINAL_DOCUMENTATION.md) |
| UMLとシステム設計 | [設計ファイル](https://github.com/daitera1/PBL4-G1/tree/main/Documentation/design) |
| 27枚の発表スライド（PDF・PowerPoint） | [発表資料](https://github.com/daitera1/PBL4-G1/tree/main/Presentation) |
| 担当、日程、週次の進捗 | [管理記録](https://github.com/daitera1/PBL4-G1/blob/main/Management/WEEKLY_REVIEW.md) |
| 提出物全体を確認するガイド | [ここから確認](https://github.com/daitera1/PBL4-G1/blob/main/PROFESSOR_START_HERE.md) |

## 結果と確認範囲

最終引き渡しには、2種類のPython実装、技術資料、デモ写真、発表資料、チームの管理記録を含めました。2026年11月12日のJira最終スナップショットでは、52件のチケットがDoneになっています。

写真と発表資料は、チームが行ったデモの記録です。パッケージの検証はファイルの整合性、リンク、Pythonの構文を対象とし、投影の校正や画質を独立して測定したものではありません。詳しい範囲と制約は[検証メモ](https://github.com/daitera1/PBL4-G1/blob/main/Documentation/verification.md)に記載しています。

![プロジェクターの作業に取り組むPBL4チーム](https://raw.githubusercontent.com/daitera1/PBL4-G1/main/Documentation/final-deliverable-2026-11-12/team.jpg)

*最終資料に収録したチーム写真。*
