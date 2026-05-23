"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none select-none items-center disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        // bg-muted is near-white in light mode and disappears against a
        // light card; bg-primary/20 (20% of foreground primary) stays
        // visible in both themes. Bumping height to h-2 also helps.
        className="relative h-2 w-full grow overflow-hidden rounded-full bg-primary/20"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="block h-4 w-4 rounded-full border-2 border-primary bg-background shadow ring-ring/50 transition-colors focus-visible:outline-none focus-visible:ring-[3px] disabled:pointer-events-none"
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
