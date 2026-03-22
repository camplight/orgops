#!/usr/bin/env python3
import asyncio
from playwright.async_api import async_playwright


async def main() -> int:
  endpoint = "ws://127.0.0.1:9222"
  url = "https://example.com"
  try:
    async with async_playwright() as p:
      browser = await p.chromium.connect_over_cdp(endpoint)
      context = await browser.new_context()
      page = await context.new_page()
      await page.goto(url, wait_until="domcontentloaded", timeout=30000)
      title = await page.title()
      print(f"ok: connected to {endpoint}")
      print(f"url: {url}")
      print(f"title: {title}")
      await context.close()
      await browser.close()
      return 0
  except Exception as exc:
    print(f"error: {exc}")
    return 1


if __name__ == "__main__":
  raise SystemExit(asyncio.run(main()))
