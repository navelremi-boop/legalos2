import type { ReactNode } from "react";
import {
  IconCalendarEvent,
  IconFile,
  IconFileInvoice,
  IconFolder,
  IconLock,
  IconMail,
  IconNote,
} from "@tabler/icons-react";
import type { ChronoType, EncartApercu } from "./types";

const ICON_PROPS = { size: 15, stroke: 1.6, "aria-hidden": true as const };

export function IconeTypeChrono({ type }: { type: ChronoType }): ReactNode {
  switch (type) {
    case "mail":
      return <IconMail {...ICON_PROPS} />;
    case "piece":
      return <IconFile {...ICON_PROPS} />;
    case "facture":
      return <IconFileInvoice {...ICON_PROPS} />;
    case "audience":
      return <IconCalendarEvent {...ICON_PROPS} />;
    case "note":
      return <IconNote {...ICON_PROPS} />;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function IconeEncart({ variante }: { variante: EncartApercu["variante"] }): ReactNode {
  const props = { size: 18, stroke: 1.6, "aria-hidden": true as const };
  switch (variante) {
    case "classement":
      return <IconFolder {...props} />;
    case "definitif":
      return <IconLock {...props} />;
    case "agenda":
      return <IconCalendarEvent {...props} />;
    case "note":
      return <IconNote {...props} />;
    default: {
      const _exhaustive: never = variante;
      return _exhaustive;
    }
  }
}

export function IconeCadenas(): ReactNode {
  return <IconLock size={11} stroke={1.8} aria-hidden />;
}
