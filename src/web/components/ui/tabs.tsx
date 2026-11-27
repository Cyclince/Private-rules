import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '../../lib/cn';
import { SlidingIndicator, useSlidingIndicator } from './sliding-indicator';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const { containerRef, rect } = useSlidingIndicator<React.ComponentRef<typeof TabsPrimitive.List>>();

  const setRefs = React.useCallback(
    (node: React.ComponentRef<typeof TabsPrimitive.List> | null) => {
      containerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [containerRef, ref],
  );

  return (
    <TabsPrimitive.List
      ref={setRefs}
      className={cn(
        'relative inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface-muted p-1 text-text-muted',
        className,
      )}
      {...props}
    >
      <SlidingIndicator
        rect={rect}
        dataTestId="tabs-indicator"
        className="motion-indicator-pill z-0 bg-surface shadow-sm"
      />
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'motion-press relative z-10 inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-transparent data-[state=active]:text-text data-[state=active]:shadow-none',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('motion-tab-panel mt-3 focus-visible:outline-2 focus-visible:outline-primary', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
