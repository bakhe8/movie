import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shellCss = readFileSync('app/components/AppShell.module.css', 'utf8').replaceAll('\r\n', '\n');
const discoverCss = readFileSync('app/components/DiscoverScreen.module.css', 'utf8').replaceAll('\r\n', '\n');

function mediaBlock(css: string, query: string, nextQuery?: string) {
  const start = css.indexOf(query);
  expect(start, `${query} must exist`).toBeGreaterThanOrEqual(0);
  const end = nextQuery ? css.indexOf(nextQuery, start + query.length) : css.length;
  expect(end, `${nextQuery ?? 'end of stylesheet'} must follow ${query}`).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe('responsive visual contracts', () => {
  it('moves navigation into the header on wide screens and landscape tablets', () => {
    const wideShell = mediaBlock(shellCss, '@media (min-width: 900px), (min-width: 768px) and (orientation: landscape)');

    expect(wideShell).toMatch(/\.withNav\s*\{\s*padding-bottom:\s*0;/);
    expect(wideShell).toMatch(/\.menuButton,[^{}]*\.tabs\s*\{\s*display:\s*none;/);
    expect(wideShell).toMatch(/\.inlineNav\s*\{[^}]*display:\s*flex;/);
  });

  it('keeps the first poster metadata clear of phone navigation without shrinking the poster', () => {
    const phoneRule = discoverCss.slice(0, discoverCss.indexOf('@media (max-width: 370px)'));
    const tabletRule = mediaBlock(discoverCss, '@media (min-width: 600px)', '@media (min-width: 1050px)');

    expect(phoneRule).toMatch(/\.screen\s*\{[^}]*gap:\s*8px;/);
    expect(phoneRule).toMatch(/\.header\s*\{[^}]*min-height:\s*104px;/);
    expect(phoneRule).toMatch(/\.header\s*\{[^}]*padding:\s*9px 16px;/);
    expect(phoneRule).toMatch(/\.grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
    expect(tabletRule).toMatch(/\.screen\s*\{[^}]*gap:\s*18px;/);
  });

  it('keeps the first desktop poster title inside the initial 1000px fold', () => {
    const desktopRule = mediaBlock(discoverCss, '@media (min-width: 1050px)', '@media (hover: hover)');

    expect(desktopRule).toMatch(/\.screen\s*\{[^}]*gap:\s*18px;/);
    expect(desktopRule).toMatch(/\.header\s*\{[^}]*min-height:\s*210px;/);
    expect(desktopRule).toMatch(/\.filmFan\s*\{[^}]*height:\s*190px;/);
    expect(desktopRule).toMatch(/\.grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,/);
  });
});
