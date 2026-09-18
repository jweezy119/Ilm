import { NextRequest } from "next/server";

import { loadSearchData, loadReaderData } from "@/lib/data";
import { getSession } from "@/lib/session";
import { withSessionJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
) {
  const sessionContext = await getSession(request);
  const { question } = await request.json();

  if (!question || !question.trim()) {
    return withSessionJson(
      sessionContext,
      {
        error: "Please provide a question",
      },
      400,
    );
  }

  try {
    // Search for relevant content
    const searchResults = await loadSearchData(
      sessionContext.session,
      question,
    );

    if (searchResults.error) {
      return withSessionJson(
        sessionContext,
        {
          error: `Search failed: ${searchResults.error}`,
        },
        500,
      );
    }

    // Generate intelligent answer based on search results
    let answer = "";
    const sources: Array<{chapter: string; verse: string}> = [];

    if (searchResults.verseItems && searchResults.verseItems.length > 0) {
      // We have verse results - provide a thoughtful answer
      
      // Analyze question type to tailor response
      const questionLower = question.toLowerCase();
      const isDefinitionQuestion = questionLower.startsWith("what is") || 
                                 questionLower.startsWith("who is") ||
                                 questionLower.includes("meaning of") ||
                                 questionLower.includes("define");
      const isHowQuestion = questionLower.startsWith("how");
      const isWhyQuestion = questionLower.startsWith("why");
      const isWhichQuestion = questionLower.startsWith("which");
      
      // Build contextual introduction
      let intro = "";
      if (isDefinitionQuestion) {
        intro = "Based on Quranic teachings, ";
      } else if (isHowQuestion) {
        intro = "The Quran provides guidance on how to ";
      } else if (isWhyQuestion) {
        intro = "Regarding the reasons behind ";
      } else if (isWhichQuestion) {
        intro = "When considering ";
      } else {
        intro = "In response to your question about ";
      }
      
      intro += `"${question}". `;
      
      // Get detailed context for top results
      const detailedResults = await Promise.all(
        searchResults.verseItems
          .slice(0, 3)
          .map(async (item) => {
            let chapter = "1";
            let verse = "1";
            
            if (item.verseKey) {
              const parts = item.verseKey.split(":");
              if (parts.length >= 2) {
                chapter = parts[0];
                verse = parts[1];
              }
            } else if (item.readerUrl) {
              const urlParts = item.readerUrl.split("/");
              const lastPart = urlParts[urlParts.length - 1];
              if (!isNaN(Number(lastPart))) {
                chapter = lastPart;
                verse = "1";
              }
            }
            
            sources.push({ chapter, verse });
            
            // Try to get a bit more context (surrounding verses) if we have the chapter
            try {
              const chapterData = await loadReaderData(
                sessionContext.session,
                chapter
              );
              
              // Find the specific verse in the chapter data
              const verseData = chapterData.verses?.find(
                (v) => v.verseKey === item.verseKey || 
                           (`${chapter}:${v.verseNumber}` === item.verseKey)
              );
              
              return {
                ...item,
                chapterData,
                verseData,
                chapter,
                verse: verse || (verseData?.verseNumber?.toString() || "1")
              };
            } catch (contextError) {
              // If we can't get extended context, just return the basic item
              return {
                ...item,
                chapter,
                verse: verse || "1",
                verseData: undefined
              };
            }
          })
      );
      
      // Build a comprehensive answer
      answer = intro + "\n\n";
      
      answer += "The Quran addresses this topic through various passages that offer guidance, wisdom, and reflection:\n\n";
      
      detailedResults.forEach((result, index) => {
        answer += (index + 1) + ". **" + (result.text || result.arabicText || "Relevant passage") + "**";
        if (result.verseData) {
          answer += ` (Chapter ${result.verse}, Verse ${result.verseData.verseNumber})`;
        }
        answer += "\n";
        
        // Add a brief explanation if we have context
        if (result.verseData && result.text) {
          answer +=   `This verse speaks to the heart of your question by highlighting ${getThemeFromText(result.text)}.`;
        }
        answer += "\n\n";
      });
      
      answer += "For a more complete understanding, consider reading the full chapters where these verses appear, as the surrounding context often provides deeper insight into their meaning and application.";
      
    } else if (searchResults.navigationItems && searchResults.navigationItems.length > 0) {
      // We have navigation results (chapters, topics, etc.)
      answer = `When exploring "${question}" in the Quran, several relevant areas come into focus:\n\n`;
      
      answer += searchResults.navigationItems
        .slice(0, 5)
        .map((item, index) => {
          const relevance = getRelevanceExplanation(item.label || "", question);
          return `${index + 1}. ${item.label}${item.subtitle ? ` - ${item.subtitle}` : ""}\n   ${relevance}`;
        })
        .join("\n\n");
      
      answer += "\n\nEach of these topics contains valuable insights related to your question. You might start with the one that resonates most with your current inquiry.";
      
    } else {
      // No specific results found - provide helpful guidance
      answer = `While I didn't find direct textual matches for "${question}" in the Quranic text, this doesn't mean the Quran lacks guidance on your topic. Consider:\n\n`;
      
      answer += `1. **Broader themes**: Your question might relate to wider Quranic themes like mercy, justice, faith, or guidance\n`;
      answer += `2. **Different terminology**: The Quran may express similar concepts using different words or phrases\n`;
      answer += `3. **Conceptual understanding**: Some questions are better addressed through understanding overall Quranic worldview rather than specific verses\n`;
      answer += `4. **Reflection and contemplation**: Many Quranic teachings reveal their depth through personal reflection and study\n\n`;
      
      answer += `To explore further, you might try:\n`;
      answer += `- Searching for related concepts like "${getAlternativeSearchTerms(question)}"\n`;
      answer += `- Exploring chapters known for their thematic depth (such as Al-Fatihah, Al-Baqarah, Al-Imran, Al-Rahman)\n`;
      answer += `- Considering what aspects of your question relate to faith, practice, or spirituality\n`;
    }

    return withSessionJson(
      sessionContext,
      {
        answer,
        sources,
      },
    );
  } catch (error) {
    console.error("Chat API error:", error);
    return withSessionJson(
      sessionContext,
      {
        error: "Failed to process your question. Please try again later.",
      },
      500,
    );
  }
}

// Helper function to extract potential themes from text
function getThemeFromText(text: string): string {
  const lowerText = text.toLowerCase();
  if (lowerText.includes("mercy") || lowerText.includes("compassionate")) return "mercy and compassion";
  if (lowerText.includes("justice") || lowerText.includes("fair")) return "justice and fairness";
  if (lowerText.includes("faith") || lowerText.includes("believe")) return "faith and trust";
  if (lowerText.includes("prayer") || lowerText.includes("worship")) return "devotion and worship";
  if (lowerText.includes("patience") || lowerText.includes("steadfast")) return "patience and perseverance";
  if (lowerText.includes("forgiveness") || lowerText.includes("forgive")) return "forgiveness and reconciliation";
  if (lowerText.includes("guidance") || lowerText.includes("guide")) return "divine guidance";
  if (lowerText.includes("love") || lowerText.includes("compass")) return "love and compassion";
  return "important spiritual principles";
}

// Helper function to explain why a navigation item might be relevant
function getRelevanceExplanation(topic: string, question: string): string {
  const lowerTopic = topic.toLowerCase();
  const lowerQuestion = question.toLowerCase();
  
  if (lowerTopic.includes("mercy") && (lowerQuestion.includes("mercy") || lowerQuestion.includes("compassionate") || lowerQuestion.includes("forgiveness"))) {
    return "This topic directly addresses the merciful nature emphasized in your question.";
  }
  
  if (lowerTopic.includes("justice") && (lowerQuestion.includes("justice") || lowerQuestion.includes("fair") || lowerQuestion.includes("right"))) {
    return "This topic explores the Quranic concept of justice, which relates to your inquiry about fairness.";
  }
  
  if (lowerTopic.includes("faith") && (lowerQuestion.includes("believe") || lowerQuestion.includes("faith") || lowerQuestion.includes("trust"))) {
    return "This topic covers faith and belief, which appears central to your question.";
  }
  
  if (lowerTopic.includes("prayer") || lowerTopic.includes("worship")) {
    return "This topic deals with worship and relationship with the Divine, which may provide context for your question.";
  }
  
  if (lowerTopic.includes("guidance")) {
    return "This topic focuses on divine guidance, which may help answer your question about direction or understanding.";
  }
  
  return "This topic contains valuable insights that may illuminate aspects of your question.";
}

// Helper function to generate alternative search terms
function getAlternativeSearchTerms(question: string): string {
  const lowerQuestion = question.toLowerCase();
  
  // Map common question themes to related Quranic concepts
  const themeMap: Record<string, string[]> = {
    mercy: ["compassion", "forgiveness", "kindness"],
    justice: ["fairness", "equity", "rights"],
    love: ["compassion", "mercy", "kindness"],
    peace: ["tranquility", "harmony", "security"],
    strength: ["courage", "fortitude", "resilience"],
    wisdom: ["knowledge", "understanding", "insight"],
    patience: ["endurance", "steadfastness", "perseverance"],
    forgiveness: ["mercy", "compassion", "reconciliation"],
    guidance: ["direction", "teaching", "clarity"]
  };
  
  // Find matching themes
  for (const [theme, alternatives] of Object.entries(themeMap)) {
    if (lowerQuestion.includes(theme)) {
      return alternatives.join(", ");
    }
  }
  
  // Default alternatives
  return "guidance, wisdom, mercy, justice";
}
