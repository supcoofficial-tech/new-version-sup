import * as React from "react";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", ...props }: DivProps) {
  return (
    <div
      className={`rounded-2xl border shadow bg-white ${className}`}
      {...props}
    />
  );
}

export function CardContent({ className = "", ...props }: DivProps) {
  return <div className={`p-4 ${className}`} {...props} />;
}

// اختیاری، اگه بعداً لازم شد:
export function CardHeader({ className = "", ...props }: DivProps) {
  return <div className={`px-4 pt-4 ${className}`} {...props} />;
}
export function CardTitle({ className = "", ...props }: DivProps) {
  return <h3 className={`text-lg font-semibold ${className}`} {...props} />;
}
export function CardDescription({ className = "", ...props }: DivProps) {
  return <p className={`text-sm text-gray-500 ${className}`} {...props} />;
}
