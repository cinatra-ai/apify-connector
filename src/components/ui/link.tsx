import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"

// Shadcn link primitive: the vendored wrapper that renders the raw <a> so
// callers never reach for a bare anchor (the ui-design-system Block-B rule
// is carved out only inside this components/ui directory). `asChild` lets a
// router-aware link (e.g. next/link) be slotted in while keeping styling.
function Link({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a"

  return (
    <Comp
      data-slot="link"
      className={cn(
        "underline underline-offset-4 transition-colors hover:text-primary",
        className,
      )}
      {...props}
    />
  )
}

export { Link }
