import logoUrl from "@/assets/logo.png";

interface BrandLogoProps {
  size?: number;
  className?: string;
}

export function BrandLogo({ size = 36, className }: BrandLogoProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] bg-primary ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-label="Everlumen logo"
    >
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="h-full w-full scale-[1.18] object-cover"
        style={{ width: size, height: size }}
      />
    </span>
  );
}
