import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface BotMessageProps {
  text: string;
  variant?: 'default' | 'loading' | 'error';
}

export default function BotMessage({ text, variant = 'default' }: BotMessageProps) {
  if (variant === 'loading') {
    return (
      <div className="flex justify-start">
        <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          <div className="flex gap-1 items-center h-4">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'error') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] xs:max-w-xs sm:max-w-sm lg:max-w-md bg-red-50 border border-red-200 text-red-700 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
          <p className="text-sm leading-relaxed">{text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] xs:max-w-xs sm:max-w-sm lg:max-w-md bg-gray-100 text-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
        <div className="text-sm leading-relaxed prose-chat">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-gray-900">{children}</strong>
              ),
              em: ({ children }) => (
                <em className="italic text-gray-700">{children}</em>
              ),
              ul: ({ children }) => (
                <ul className="mt-1 mb-1.5 space-y-0.5 pl-4 list-none">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="mt-1 mb-1.5 space-y-0.5 pl-4 list-none counter-reset-[item]">{children}</ol>
              ),
              li: ({ children, ...props }) => {
                const ordered = (props as { ordered?: boolean }).ordered;
                return ordered ? (
                  <li className="flex gap-2 text-sm text-gray-700 before:content-[counter(item)'.'] before:counter-increment-[item] before:font-medium before:text-gray-500 before:shrink-0">
                    {children}
                  </li>
                ) : (
                  <li className="flex gap-1.5 text-sm text-gray-700">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-400 shrink-0" />
                    <span>{children}</span>
                  </li>
                );
              },
              h1: ({ children }) => (
                <h1 className="text-base font-bold text-gray-900 mt-2 mb-1">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-sm font-bold text-gray-900 mt-2 mb-1">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold text-gray-800 mt-1.5 mb-0.5">{children}</h3>
              ),
              hr: () => <hr className="my-2 border-gray-300" />,
              blockquote: ({ children }) => (
                <blockquote className="pl-3 border-l-2 border-blue-300 text-gray-600 italic my-1.5">
                  {children}
                </blockquote>
              ),
              code: ({ children, ...props }) => {
                const inline = !(props as { inline?: boolean }).inline === false;
                return inline ? (
                  <code className="bg-white/60 px-1 py-0.5 rounded text-xs font-mono text-gray-800">
                    {children}
                  </code>
                ) : (
                  <pre className="bg-white/60 rounded p-2 text-xs font-mono text-gray-800 overflow-x-auto my-1.5">
                    <code>{children}</code>
                  </pre>
                );
              },
              table: ({ children }) => (
                <div className="overflow-x-auto my-2">
                  <table className="w-full text-xs border-collapse">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="px-2 py-1 bg-gray-200 text-gray-700 font-semibold text-left border border-gray-300">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-2 py-1 border border-gray-300 text-gray-700">{children}</td>
              ),
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
