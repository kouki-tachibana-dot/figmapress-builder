# FigmaPress 品質強化の実装・検証記録

実施日: 2026-09-08。基準 `bfd229d`（v0.30.5）。作業ブランチ `codex/quality-hardening-20260908`。

計画コミット `04179a5`、実装・回帰試験コミット `19006d8`。作業場所は `figmapress-quality`。旧作業フォルダと直前の監査コピーは保持した。

## 現在地

Builder v0.31.0 / Connector v0.19.8 のローカル候補版を実装。**未配信・未公開**。この作業では公開WordPress、既存9下書き、公開メニュー、実メール送信を変更していない。

「99.9%完成」とは判定しない。原本との視覚一致、実WordPress保存後の動作、編集耐性には未検証項目がある。計画は [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)、必須条件は [ACCEPTANCE_CRITERIA.md](./ACCEPTANCE_CRITERIA.md) に記録した。

## 実装した改善

| 対象 | 修正 | 現時点の証拠 |
| --- | --- | --- |
| 内部リンク | 推測した `/home/` 等のURLを撤去。対象サイト・source key・下書きID・preview URLが一致するWordPress応答だけを採用 | 未取得・別サイト・別ディレクトリ・誤ID・公開済み・重複・危険URLを拒否する単体試験 |
| 視覚QA | `runVisualQa` が対象端末のdisplayを強制する処理を撤去。実CSSで1端末だけ可視か検査 | CSSなし・誤端末・全非表示・透明化を、DOMの表示修正なしで不合格にするブラウザ試験 |
| レスポンシブ | PCのみ/PC+SP/PC+Tablet/3端末で安全に継承。Elementorのmobile/tablet設定値をPHPから取得 | 320/390/440/767/768/834/1024/1025/1440px、カスタム600/900pxの境界を確認 |
| 資料リンク | アコーディオンに入るFigmaの明示URLを維持。未接続PDF/ダウンロード文言を保存前に検出 | ネイティブ/代替Accordion、リンクあり/なし、別リンクとの混在の単体試験 |
| 編集性 | 重なりがなく幅・左端・間隔が揃った縦積みだけ、通常のFlexコンテナに変換 | 元データ非破壊、余白・間隔、通常配置、重なり/装飾/絶対指定を推定しない試験 |
| 誤解しにくい表示 | 「生成完了」と「品質合格」を区別。常時LIVE表示と初回アクセスでの誤った旧版通知を撤去 | PC/スマホの実操作と自動ブラウザ試験 |
| 配布と回帰 | ZIP全ファイル・manifest・PHP・readme・packageの一致検査、CIのブラウザ試験と失敗証拠保存 | ローカルで全内容一致。GitHub CIは未送信・未実行 |

## 検証結果

- `npm run test:product`: 単体245件、型検査、Lint、Next.js本番ビルドが成功。
- `npm run test:e2e`: Chromiumで12件成功。うち9件は生成ルート/CSS/QA helperの隔離フィクスチャ、3件はBuilder実APIでのPC/SPサンプル変換と不正JSON検出。
- PHP構文: 13ファイル成功。
- `npm audit --omit=dev --audit-level=high`: 検出0件。
- `git diff --check`: 成功。
- Builder UIの検証では実WordPress APIを遮断し、呼び出し0件、JavaScript/consoleエラー0件、親画面とプレビューの横はみ出し0件を確認。
- Playwrightのtrace用スクリプトが保護iframeに拒否されることを切り分けた。アプリのsandboxを緩めず、Builder試験だけtraceを無効にして失敗スクリーンショットを保存する。エラーを無視するフィルタは使用していない。

### 画面証拠

- [Builder 1440px](./qa/2026-09-08/builder-converted-1440.png)
- [Builder 390px](./qa/2026-09-08/builder-converted-390.png)

これは同梱JSONサンプルのBuilder画面であり、建工101 FigmaとWordPressの一致画像ではない。Figma差分画像/差分率は今回未取得。

## 残る条件・制限

1. **全9ページの実機検証**: Connector更新の承認後、公開ページを変更せず検証用下書きで保存・再読込・リンク巡回・PC/SP/Tabletの原本比較を行う。
2. **正式資料**: 請求書フォーマットPDFとWeb資料の実ファイル/正式URLが未提供。存在しない資料URLは生成しない。未接続のまま保存しようとすると停止する。
3. **対応表の再取得UX**: 今回のページ対応表は同じアプリセッション内の下書き準備応答を使用する。再読み込み後は単独レビューコピーの前にサイト一式の準備が必要。読み取り専用の対応表再取得は次フェーズ。
4. **編集性は部分改善**: 自由配置や装飾の絶対配置は残る。縦積みグループの外側が絶対配置の場合もある。実Elementorで文量2倍・途中追加・並べ替え・再保存する試験は未実施。
5. **継続運用**: 既存の保存ハッシュ/リビジョン機構は保持したが、Figma差分と人の手修正を比較して競合を解決する新しい更新フローは未実装。
6. **機能**: 実Proウィジェットの編集・保存・再初期化、フォームのテスト送信と受信、実PDFの取得確認は未実施。送信先/テスト送信は別途確認する。
7. **原本比較**: 既存の全テキスト表示診断と視覚スコアだけでは合格にしない。今回の無補正検査は視覚QAの端末ルート切替に対する改善であり、実サイト全体のCSS/機能を検証した証拠ではない。

## 次の実行順序

1. 新版の配信・テストWordPressのConnector更新について承認を確認。
2. Figma原本のPC/SP/存在するTabletと、既存9ページの対応を再取得。新しい検証用下書きに限定して構築。
3. 正式資料リンクを接続し、全リンクが正しい下書きIDへ到達することを認証済みブラウザで確認。
4. セクション高→文字→画像→装飾の順で原本差分を修正。原本と同じ幅の画像・差分JSONを保存。
5. 実Elementorで通常編集・保存再読込・Pro機能・キーボード操作を確認し、未実施を0件にする。
6. 手修正競合の検出と復元フローを追加。全必須条件を満たした時点で公開可否を判断する。公開そのものは別承認。

## 参照した公式仕様

- [Elementor breakpoint system](https://developers.elementor.com/breakpoint-system-changes-in-elementor-v3-2-0/): 登録済みブレークポイントの取得と値参照。
- [Elementor responsive data](https://developers.elementor.com/docs/data-structure/responsive-data): 端末別設定を持つネイティブデータ構造。
- [GitHub upload-artifact](https://github.com/actions/upload-artifact): ブラウザ失敗時の証拠をCI artifactとして保持。

reference-site-builderスキルに沿い、承認されたFigmaを正本に据え、視覚一致の証拠がない項目を完了扱いしない工程にした。
