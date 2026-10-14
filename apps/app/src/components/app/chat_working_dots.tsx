import '@/components/app/chat_activity_breathe.css';

const chat_working_dot_delays = ['0s', '0.15s', '0.3s'];

export function ChatWorkingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-[5px]">
      {chat_working_dot_delays.map((delay) => (
        <span
          className="chat-working-dot size-[7px] rounded-full bg-brand"
          key={delay}
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}
