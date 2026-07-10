import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-sm border border-edge-strong bg-base px-3 text-body-ui text-fg placeholder:text-fg-tertiary transition-colors focus-visible:border-primary disabled:bg-hover disabled:text-fg-disabled aria-invalid:border-danger";

interface FieldWrapperProps {
  label?: string;
  required?: boolean;
  helper?: string;
  error?: string;
  id: string;
  children: ReactNode;
}

/** label 上置、必填星號、helper/error 下置（設計規範 §4.4）。 */
function FieldWrapper({ label, required, helper, error, id, children }: FieldWrapperProps) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <label htmlFor={id} className="text-body-ui font-medium text-fg">
          {label}
          {required ? (
            <span aria-hidden className="ml-0.5 text-danger">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : helper ? (
        <p className="text-caption text-fg-tertiary">{helper}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
}

export function Input({ label, helper, error, required, className, id, ...props }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldWrapper label={label} required={required} helper={helper} error={error} id={inputId}>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(fieldClass, "h-9", className)}
        {...props}
      />
    </FieldWrapper>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
}

export function Textarea({
  label,
  helper,
  error,
  required,
  className,
  id,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldWrapper label={label} required={required} helper={helper} error={error} id={inputId}>
      <textarea
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(fieldClass, "min-h-20 py-2", className)}
        {...props}
      />
    </FieldWrapper>
  );
}
