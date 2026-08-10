import React from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DesktopRendererTest = () => (
  <main data-desktop-renderer-test-ready>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="More actions" title="More actions">
          More
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Rename</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Select defaultValue="notebook-one">
      <SelectTrigger aria-label="Notebook">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="notebook-one">Notebook one</SelectItem>
        <SelectItem value="notebook-two">Notebook two</SelectItem>
      </SelectContent>
    </Select>
  </main>
);

const root = document.getElementById("desktop-renderer-test-root");

if (!root) {
  throw new Error("Desktop renderer test root not found");
}

createRoot(root).render(
  <React.StrictMode>
    <DesktopRendererTest />
  </React.StrictMode>
);
