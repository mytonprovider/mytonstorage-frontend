import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cx } from "@/lib/cx"
import styles from "./icon-button.module.css"

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string
  size?: "xs" | "sm" | "md" | "lg"
  danger?: boolean
  ok?: boolean
  children: ReactNode
}

export const IconButton = ({ label, size = "md", danger, ok, children, className, ...rest }: IconButtonProps) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    className={cx(styles.button, styles[size], danger && styles.danger, ok && styles.ok, className)}
    {...rest}
  >
    {children}
  </button>
)
