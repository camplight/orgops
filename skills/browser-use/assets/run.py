import asyncio
import os
import sys

from browser_use import Agent, Browser, ChatBrowserUse


async def run(task: str):
    browser = Browser()
    llm = ChatBrowserUse()
    agent = Agent(task=task, llm=llm, browser=browser)
    history = await agent.run()
    return history


if __name__ == "__main__":
    task = " ".join(sys.argv[1:]).strip() or os.getenv("BROWSER_USE_TASK", "")
    if not task:
        print("Usage: python run.py <task> or set BROWSER_USE_TASK")
        sys.exit(1)
    asyncio.run(run(task))
