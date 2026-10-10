import { Badge as WorkbenchBadge, Button as WorkbenchButton } from "../ui.js";
import { useEffect, useState, type ReactNode } from "react";
import { readImage } from "./api.js";

export type Tone = "neutral" | "good" | "warning" | "bad" | "info";
const tones = { neutral: "neutral", good: "green", warning: "amber", bad: "red", info: "blue" } as const;
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <WorkbenchBadge tone={tones[tone]}>{children}</WorkbenchBadge>;
}
export function Spinner() { return <span className="fa-spinner" aria-hidden="true" />; }
export function Button({ children, className = "", busy = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <WorkbenchButton {...props} busy={busy} variant={className.includes("button-primary") ? "primary" : className.includes("button-quiet") ? "quiet" : "default"}>{children}</WorkbenchButton>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="fa-empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function Section({ eyebrow, title, action, children, className = "" }: { eyebrow?: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`inspection-panel ${className}`}><header className="inspection-section-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action}</header>{children}</section>;
}
export function AuthImage({ token, taskId, assetId, alt, className = "" }: { token: string; taskId: string; assetId: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null); setError(false);
    readImage(token, taskId, assetId, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token, taskId, assetId, attempt]);
  if (error) return <span className="image-fallback">画像を読み込めませんでした<Button type="button" className="button-small" onClick={() => setAttempt(v => v + 1)}>再読込</Button></span>;
  if (!url) return <span className="image-fallback"><Spinner /><span>画像を読込中</span></span>;
  return <img className={className} src={url} alt={alt} />;
}

export const labels: Record<string, string> = {
  model: "製品型式", installation: "取付状態", mounting: "取付方式", orientation: "現物の方向", verticalReference: "上下の基準",
  escutcheon: "埋込シーリングプレート", bulbCondition: "感熱ガラス球の状態", installationWrench: "施工に使用したレンチ", threadStandard: "接続ねじ規格", installationTorqueFtLb: "締付トルク（ft·lbf）",
  construction: "新設・改修", fieldFinish: "現場での塗装・表面処理", leakage: "漏れ", corrosion: "腐食", workingPressurePsi: "系統の最高使用圧力（psi）", approvalBasis: "適用する認証",
  style_10: "Style 10", style_20: "Style 20", style_30: "Style 30", style_40: "Style 40", other: "その他",
  intact: "損傷・液体の欠損なし", cracked: "ひび・損傷あり", liquid_loss: "液体の欠損あり", w_type_6: "W-Type 6", w_type_7: "W-Type 7", npt: "NPT", iso7_1: "ISO 7-1",
  new: "新設", retrofit: "改修", factory_only: "工場出荷時の仕上げのみ", field_painted: "現場で塗装", field_plated: "現場でめっき", field_coated: "現場で被覆", absent: "なし", present: "あり", ul_cul: "UL / C-UL",
  pressureBasis: "圧力値の根拠", system_maximum: "確認済みの系統の最高使用圧力", spot_reading: "一時点の圧力計の値", catalog_rating: "製品カタログの許容上限", test_pressure: "試験圧力",
  installed: "取付済み", uninstalled: "未取付け", standard: "通常形・非埋込", recessed: "埋込",
  pendent: "下向き", upright: "上向き", sideways: "横向き", unknown: "不明",
  gravity: "重力方向", verified_record: "確認済みの記録", manual: "人が確認", model_source: "AIの候補", fixture: "合成データ",
  capture: "追加撮影", measurement: "追加計測", confirmation: "確認依頼",
  open: "回答待ち", answered: "回答済み", unavailable: "取得不能", superseded: "旧版・失効",
  active: "確認中", waiting: "追加情報待ち", review_ready: "資料作成済み", cancelled: "中止済み",
};
export function label(value: string | number | null | undefined): string { return value === null || value === undefined || value === "" ? "未入力" : labels[value] ?? String(value); }
export function fieldLabel(path: string): string {
  const [key, detail] = path.split(".");
  return `${label(key)}${detail?.startsWith("evidenceIds") ? "の根拠" : detail === "confirmation" ? "の確認" : detail ? ` · ${detail}` : ""}`;
}
export function dateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
