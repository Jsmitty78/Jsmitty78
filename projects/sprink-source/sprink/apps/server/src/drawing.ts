import type { PlanModel } from './models.js';

import { exampleDrawing, renderDrawingSvg } from '@sprink/core';

export function planSvg(plan: PlanModel): string {
  return renderDrawingSvg(plan.drawing ?? exampleDrawing(plan.orientation), plan.revision);
}

export function sceneSvg(orientation: string, detail = false, obstacle = false): string {
  const up=orientation==='upright';
  const sideways=orientation==='sideways';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650"><rect width="1000" height="650" fill="#ece9df"/><path d="M0 70H1000M0 570H1000" stroke="#c7c3b7" stroke-width="3"/><g fill="#696d68"><rect x="60" y="245" width="870" height="30" rx="12"/><rect x="130" y="60" width="8" height="186"/><rect x="850" y="60" width="8" height="186"/></g>${orientation==='unknown'?'<rect x="480" y="175" width="170" height="265" rx="15" fill="#a8aaa2"/><text x="500" y="350" font-family="sans-serif" fill="#fff">OCCLUDED</text>':`<g transform="translate(565 260) rotate(${sideways?90:up?180:0})"><path d="M0 0v58" stroke="#8a7657" stroke-width="14"/><path d="M-20 58v57h40V58" fill="none" stroke="#957642" stroke-width="8"/><rect x="-4" y="65" width="8" height="40" rx="4" fill="#c15240"/><path d="M-37 120h74" stroke="#957642" stroke-width="8"/></g>`}${obstacle?'<rect x="700" y="290" width="210" height="155" fill="#9c7860"/><text x="740" y="375" fill="white" font-family="sans-serif">O1 / BOX</text>':''}<g font-family="sans-serif" fill="#33473d"><text x="35" y="38" font-size="24">SYNTHETIC ${detail?'DETAIL':'SITE'} — NOT A PHOTOGRAPH</text><text x="40" y="620" font-size="18">Vertical reference: gravity down ↓</text><text x="130" y="220" font-size="22">P1</text><text x="430" y="${up?105:470}" font-size="24">H1 / TY3231</text><text x="35" y="540" font-size="17">Demonstration scene; positions and dimensions are artificial.</text></g></svg>`;
}
