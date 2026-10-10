import { TinyFish } from '@tiny-fish/sdk';
import { NextResponse } from 'next/server';

const tf = new TinyFish({
  apiKey: "sk-tinyfish-qTthlASTnsi4_naSkSd_CcZbnwKrxHLE",
});

export async function POST(request: Request) {
  try {
    const { message } = await request.json();

    const response = await tf.search.query({
      query: message,
      purpose: "Answering a user query on the website",
    });

    if (!response.results || response.results.length === 0) {
        return NextResponse.json({ reply: "I couldn't find any information on that." });
    }

    const topResults = response.results.slice(0, 3).map((r: any) => 
      `<div class="mb-3">
        <a href="${r.url}" target="_blank" class="font-bold text-blue-500 hover:underline">${r.title}</a>
        <p class="text-sm text-gray-600 mt-1">${r.snippet}</p>
      </div>`
    ).join('');

    const reply = `<div class="text-sm"><p class="mb-3">Here is what I found on the web:</p>${topResults}</div>`;

    return NextResponse.json({ reply });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ reply: "Sorry, I encountered an error searching the web." }, { status: 500 });
  }
}
