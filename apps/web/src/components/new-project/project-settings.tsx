"use client";

import { ChevronDownIcon, InfoIcon } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Fixed settings used by packages/utils/src/build-app.ts. */
const buildSettings = [
  {
    description:
      "The command your frontend framework provides for compiling your code.",
    label: "Build Command",
    name: "buildCommand",
    value: "npm run build",
  },
  {
    description:
      "The directory in which your compiled frontend will be located.",
    label: "Output Directory",
    name: "outputDirectory",
    value: "dist",
  },
  {
    description:
      "The command that is used to install your project's software dependencies.",
    label: "Install Command",
    name: "installCommand",
    value: "npm ci --include=dev",
  },
];

interface ProjectSettingFieldProps {
  className?: string;
  description?: string;
  icon?: ReactNode;
  label: string;
  name: string;
  value: string;
}

function ProjectSettingField({
  className,
  description,
  icon,
  label,
  name,
  value,
}: ProjectSettingFieldProps) {
  const id = useId();
  const inputProps = {
    "aria-describedby": description ? `${id}-description` : undefined,
    disabled: true,
    id,
    name,
    type: "text",
    value,
  };

  return (
    <Field className={className} data-disabled>
      <div className="flex items-center gap-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {Boolean(description) && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`About ${label}`}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <InfoIcon aria-hidden="true" data-icon="inline-start" />
              </TooltipTrigger>
              <TooltipContent>{description}</TooltipContent>
            </Tooltip>
            <p className="sr-only" id={`${id}-description`}>
              {description}
            </p>
          </>
        )}
      </div>
      {icon ? (
        <InputGroup>
          <InputGroupAddon align="inline-start">{icon}</InputGroupAddon>
          <InputGroupInput {...inputProps} />
        </InputGroup>
      ) : (
        <Input {...inputProps} />
      )}
    </Field>
  );
}

/** Displays fixed project and build settings with editing disabled. */
export function ProjectSettings({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <FieldGroup>
        <ProjectSettingField
          icon={
            <Image
              alt=""
              className="shrink-0"
              height={20}
              src="/vite.svg"
              width={20}
            />
          }
          label="Application Preset"
          name="applicationPreset"
          value="Vite"
        />
        <ProjectSettingField
          label="Root Directory"
          name="rootDirectory"
          value="./"
        />
      </FieldGroup>
      <Collapsible
        className="rounded-lg border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
        defaultOpen
      >
        <h2>
          <CollapsibleTrigger
            className="group/build-settings flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left font-medium text-muted-foreground text-sm outline-none hover:text-foreground"
            type="button"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 -rotate-90 transition-transform duration-200 ease-out group-aria-expanded/build-settings:rotate-0 motion-reduce:transition-none"
            />
            Build and Output Settings
          </CollapsibleTrigger>
        </h2>
        <CollapsibleContent className="p-3" keepMounted>
          <FieldGroup className="gap-6">
            {buildSettings.map((setting) => (
              <ProjectSettingField key={setting.name} {...setting} />
            ))}
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
