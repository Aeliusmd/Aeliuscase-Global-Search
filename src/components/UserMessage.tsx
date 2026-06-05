interface UserMessageProps {
  text: string;
}

export default function UserMessage({ text }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] xs:max-w-xs sm:max-w-sm lg:max-w-md bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{text}</p>
      </div>
    </div>
  );
}
