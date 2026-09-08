"use client";
import { createContext } from "react";
/** Prevent replacing the embedded editor while its changes are unsaved. */
export const VendorQueueEditingContext = createContext<((busy: boolean) => void) | null>(null);
