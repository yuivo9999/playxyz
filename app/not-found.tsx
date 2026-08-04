"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
      <h2 className="text-3xl font-bold mb-2">404 - 页面未找到</h2>
      <p className="text-slate-400 mb-6">您访问的页面不存在。</p>
      <Link
        href="/"
        className="px-4 py-2 bg-amber-500 text-slate-950 font-semibold rounded-lg hover:bg-amber-400 transition-colors"
      >
        返回首页
      </Link>
    </div>
  );
}
