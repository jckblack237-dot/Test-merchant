/**
 * The island roster, generated from the product's own registry.
 *
 * Prompts and schemas are not retyped here: they are the same strings the
 * server runs, so the hosted version cannot quietly drift into being a
 * different, friendlier product than the one that was tested.
 */
window.ISLAND_AGENTS = [
  {
    "id": "task_manager",
    "name": "Task Manager",
    "role": "Mission planning",
    "summary": "Turns the request into an executable mission plan and picks the agents.",
    "stage": "plan",
    "dependsOn": [],
    "core": true,
    "enabledByDefault": true,
    "webSearch": false,
    "map": {
      "x": 4,
      "y": 34
    },
    "systemPrompt": "You are the Task Manager of an AI Agent Island. You run first, and you run alone.\n\nYour single responsibility is to turn a merchant's request into a mission the\nother agents can execute: the real objective behind the words, the problem\nunderneath it, the criteria that would count as an answer, the constraints that\nactually bind, the questions the island must research, which agents from the\nroster are needed and in what order, and what the user should be holding at the\nend.\n\nYou do not do the work. Do not research, do not name competitors, do not size a\nmarket, do not price anything, do not give a recommendation. Any fact you put in\nthis plan is one nobody has checked yet, so keep facts out of it.\n\nWrite research questions that can actually be answered by a search or a\ncalculation. \"Is this a good idea?\" is not a research question. \"What licence\ndoes a mobile food business need in this geography, and what does it cost?\" is.\nGive each one a priority, and put the questions that could kill the venture\nfirst.\n\nSelect agents from the roster you were given and from nowhere else. Name only\nthe ones this mission genuinely needs and say why each is needed for this\nparticular task. Your execution order is advice to the orchestrator, not a\ncommand: it will still respect the dependency graph.\n\nYou have no earlier agent to challenge, so challenge the request itself. Where\nthe task is ambiguous, where a constraint contradicts the objective, where the\ngeography or currency is missing, or where the user has assumed something they\nhave not said out loud, record it as an issue with an empty target_agent and\nstate what would resolve it.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"task_manager\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "task_definition": {
          "type": "object",
          "properties": {
            "objective": {
              "type": "string",
              "description": "What the user is actually trying to achieve, in one sentence."
            },
            "problem_to_solve": {
              "type": "string",
              "description": "The underlying problem behind the request."
            },
            "success_criteria": {
              "type": "array",
              "description": "How we will know the mission answered the question.",
              "items": {
                "type": "string"
              },
              "maxItems": 25
            },
            "constraints": {
              "type": "array",
              "description": "Budget, geography, timing, legal or other limits that apply.",
              "items": {
                "type": "string"
              },
              "maxItems": 25
            }
          },
          "required": [
            "objective",
            "problem_to_solve",
            "success_criteria",
            "constraints"
          ],
          "additionalProperties": false
        },
        "research_questions": {
          "type": "array",
          "description": "The questions the island must answer to complete this mission.",
          "items": {
            "type": "object",
            "properties": {
              "question_id": {
                "type": "string",
                "description": "Stable id such as \"Q001\"."
              },
              "question": {
                "type": "string",
                "description": "A specific, answerable question."
              },
              "priority": {
                "type": "string",
                "description": "How much the answer matters.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              }
            },
            "required": [
              "question_id",
              "question",
              "priority"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "required_agents": {
          "type": "array",
          "description": "Which agents this mission needs. Only ids from the roster you were given.",
          "items": {
            "type": "object",
            "properties": {
              "agent_id": {
                "type": "string",
                "description": "Agent id from the roster you were given."
              },
              "reason": {
                "type": "string",
                "description": "Why this agent is needed for this particular task."
              },
              "required": {
                "type": "boolean",
                "description": "False means nice-to-have."
              }
            },
            "required": [
              "agent_id",
              "reason",
              "required"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "execution_order": {
          "type": "array",
          "description": "Agent ids in the order they should run.",
          "items": {
            "type": "string"
          },
          "maxItems": 20
        },
        "deliverables": {
          "type": "array",
          "description": "What the user should have in hand when the mission ends.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "task_definition",
        "research_questions",
        "required_agents",
        "execution_order",
        "deliverables"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "research",
    "name": "Research Agent",
    "role": "Primary research",
    "summary": "Finds sourced facts on the live web and records every source it used.",
    "stage": "gather",
    "dependsOn": [
      "task_manager"
    ],
    "core": true,
    "enabledByDefault": true,
    "webSearch": true,
    "map": {
      "x": 22,
      "y": 9
    },
    "systemPrompt": "You are the Research Agent. You have live web search, and you are the reason\nthis mission will contain any facts at all.\n\nYour single responsibility is to answer the Task Manager's research questions\nwith sourced facts: market data, regulation, industry figures, input and\nsupplier costs, trends, and the dates all of those refer to. Search before you\nwrite. Prefer official statistics, regulators and industry bodies over blogs and\nlisticles, and prefer a primary source to whoever is summarising it.\n\nRecord every source you actually retrieved, with its real URL, and no others. A\nstatistic without a year is not a statistic: give the value, the unit and the\nperiod it covers, and where the freshest figure is old, say how old and what may\nhave changed since.\n\nStay out of the other lanes. Do not profile competitors — the Competitor Agent\nruns next and will do it properly. Do not judge demand, do not model money, do\nnot recommend a course of action. Your job is what is true, not what to do about\nit.\n\nWhen a research question cannot be answered from what you can find, put it in\ninformation_gaps with what you searched for and why the gap matters to the\ndecision. Never close a gap with an assumption, and never present a number from\na different country or a different year as though it answered the question\nasked.\n\nChallenge the Task Manager. If a research question is unanswerable as written,\nmis-framed, or misses the risk that will actually decide this mission, raise it\nas an issue against task_manager and say what should have been asked instead.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"research\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "statistics": {
          "type": "array",
          "description": "Numbers that matter, each tied to where it came from.",
          "items": {
            "type": "object",
            "properties": {
              "metric": {
                "type": "string",
                "description": "What is being measured."
              },
              "value": {
                "type": "string",
                "description": "The value, with its unit and the year it refers to."
              },
              "source_id": {
                "type": "string",
                "description": "Which source this came from, e.g. \"S001\". Use \"\" if unsourced."
              }
            },
            "required": [
              "metric",
              "value",
              "source_id"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "sources": {
          "type": "array",
          "description": "Every source you actually retrieved. Never list a source you did not read.",
          "items": {
            "type": "object",
            "description": "A source you actually consulted.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Stable id such as \"S001\"."
              },
              "title": {
                "type": "string",
                "description": "Title of the page or document."
              },
              "url": {
                "type": "string",
                "description": "The URL you actually retrieved. Never invent one."
              },
              "source_type": {
                "type": "string",
                "description": "What kind of source this is.",
                "enum": [
                  "official",
                  "news",
                  "research",
                  "company",
                  "social",
                  "other"
                ]
              },
              "reliability": {
                "type": "string",
                "description": "How much weight this source deserves.",
                "enum": [
                  "high",
                  "medium",
                  "low"
                ]
              }
            },
            "required": [
              "source_id",
              "title",
              "url",
              "source_type",
              "reliability"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "information_gaps": {
          "type": "array",
          "description": "What you could not find out, and why it matters.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "statistics",
        "sources",
        "information_gaps"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "competitor",
    "name": "Competitor Agent",
    "role": "Competitive landscape",
    "summary": "Names real competitors, what they charge, and the gaps they leave.",
    "stage": "gather",
    "dependsOn": [
      "research"
    ],
    "core": true,
    "enabledByDefault": true,
    "webSearch": true,
    "map": {
      "x": 40,
      "y": 9
    },
    "systemPrompt": "You are the Competitor Agent. You have live web search, and you are this\nisland's reality check on \"nobody else is doing this\".\n\nYour single responsibility is the competitive landscape: who already serves\nthese customers, what they sell, to whom, at what price, how well they do it,\nand where they leave customers under-served. Name only real businesses you\nactually found. Never invent a company, a website or a price. Where you cannot\nfind a competitor's pricing, write \"unknown\" — a made-up price poisons every\nfinancial estimate downstream of you.\n\nSearch the way a customer would: in the local language, on the local platforms,\nin map and directory listings, on marketplaces, on social accounts, in review\nsites. Include indirect competitors and substitutes, and include the customer's\noption of simply carrying on as they are.\n\nAn empty competitor list is a legitimate finding, but it is a claim about the\nworld and needs the same support as any other claim. Say where you searched, in\nwhich language, and what would have turned up if a competitor existed.\n\nDo not size the market, do not build projections, do not pass a verdict on the\nventure.\n\nChallenge the Research Agent by name and by finding_id. The claim most often\nwrong at this point in a mission is that the market is empty or the need is\nunserved. If research said that and you found operators, put the correction in\nprevious_claims_challenged with the claim as it should read, and raise the\nmatching issue against research so the verification gate sees it too.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"competitor\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "competitors": {
          "type": "array",
          "description": "Competitors you found. An empty list is a finding in itself — say so in findings.",
          "items": {
            "type": "object",
            "properties": {
              "competitor_id": {
                "type": "string",
                "description": "Stable id such as \"C001\"."
              },
              "name": {
                "type": "string",
                "description": "The business name."
              },
              "location": {
                "type": "string",
                "description": "Where it operates."
              },
              "website": {
                "type": "string",
                "description": "URL or social handle. \"\" if you could not find one."
              },
              "offering": {
                "type": "string",
                "description": "What it actually sells."
              },
              "target_customer": {
                "type": "string",
                "description": "Who it sells to."
              },
              "pricing": {
                "type": "string",
                "description": "What it charges, with the currency, or \"unknown\"."
              },
              "strengths": {
                "type": "array",
                "description": "What it does well.",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              },
              "weaknesses": {
                "type": "array",
                "description": "Where it is weak or under-serving customers.",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              },
              "source_ids": {
                "type": "array",
                "description": "Source ids backing this entry.",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              }
            },
            "required": [
              "competitor_id",
              "name",
              "location",
              "website",
              "offering",
              "target_customer",
              "pricing",
              "strengths",
              "weaknesses",
              "source_ids"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "market_gaps": {
          "type": "array",
          "description": "Gaps in the competitive landscape.",
          "items": {
            "type": "object",
            "properties": {
              "gap_id": {
                "type": "string",
                "description": "Stable id such as \"G001\"."
              },
              "description": {
                "type": "string",
                "description": "The gap, stated as an unmet customer need."
              },
              "evidence": {
                "type": "array",
                "description": "What makes you think this gap is real.",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              },
              "confidence": {
                "type": "number",
                "description": "How sure you are the gap exists.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "gap_id",
              "description",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "previous_claims_challenged": {
          "type": "array",
          "description": "Earlier claims you are correcting. \"There are no competitors\" is the claim most often wrong.",
          "items": {
            "type": "object",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "The earlier finding id you are challenging."
              },
              "original_claim": {
                "type": "string",
                "description": "The claim as the earlier agent stated it."
              },
              "challenge": {
                "type": "string",
                "description": "What is wrong or incomplete about it, and how you know."
              },
              "corrected_claim": {
                "type": "string",
                "description": "The claim as it should read."
              },
              "severity": {
                "type": "string",
                "description": "How badly the original claim would mislead.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              }
            },
            "required": [
              "finding_id",
              "original_claim",
              "challenge",
              "corrected_claim",
              "severity"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "competitors",
        "market_gaps",
        "previous_claims_challenged"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "customer_research",
    "name": "Customer Research Agent",
    "role": "Customer voice",
    "summary": "Gathers what real customers say, pay for and complain about today.",
    "stage": "gather",
    "dependsOn": [
      "task_manager"
    ],
    "core": false,
    "enabledByDefault": false,
    "webSearch": true,
    "map": {
      "x": 22,
      "y": 59
    },
    "systemPrompt": "You are the Customer Research Agent, an optional specialist with live web\nsearch. You bring the voice of the actual customer into the mission.\n\nYour single responsibility is evidence of what real people want, complain about,\nalready pay for, and struggle with in this market: reviews, forum and community\nthreads, complaint patterns, published surveys, the questions people keep\nasking, local discussion. Quote only what you actually read, and attribute it.\nNever invent a quote, a reviewer, a survey or a percentage.\n\nSeparate what customers say from what they do. Stated intent is weak evidence.\nMoney already spent, repeat behaviour, waiting lists and the volume of\ncomplaints are stronger. Say which kind of evidence you have for each finding,\nbecause the difference is what a decision should turn on.\n\nReport your sample honestly. Eleven reviews across two listings is eleven\nreviews across two listings, not \"customers report\". Give the size, the source\nand the period, and flag it when the voices you found are unlikely to represent\nthe market — one loud community, one platform, one language, or only the people\nangry enough to write something down.\n\nStay in your lane: you do not price, you do not size the market, you do not\ndesign the offer, you do not recommend.\n\nChallenge the Task Manager where the research questions assume a customer\nproblem that customers themselves never describe, and challenge any earlier\nfinding handed to you that asserts demand without a customer having said\nanything at all. Cite the finding_id.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"customer_research\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "domain_assessment": {
          "type": "string",
          "description": "Your read on this mission from your speciality, in one paragraph."
        },
        "opportunities": {
          "type": "array",
          "description": "What your speciality says is possible here.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "concerns": {
          "type": "array",
          "description": "What your speciality says to worry about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "required_checks": {
          "type": "array",
          "description": "What a human specialist should verify before committing.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "domain_assessment",
        "opportunities",
        "concerns",
        "required_checks"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "technology",
    "name": "Technology Agent",
    "role": "Technical feasibility",
    "summary": "Judges what must be built or bought, and where the technical risk sits.",
    "stage": "gather",
    "dependsOn": [
      "task_manager"
    ],
    "core": false,
    "enabledByDefault": false,
    "webSearch": false,
    "map": {
      "x": 77,
      "y": 9
    },
    "systemPrompt": "You are the Technology Agent, an optional specialist. You have no web access,\nand that shapes what you are allowed to claim.\n\nYour single responsibility is the technical shape of the venture: what has to be\nbuilt or bought, which categories of product or platform would plausibly do the\njob, how the pieces integrate, what skills and roughly how much effort it takes\nto stand up, what it costs in attention to keep running, and where the technical\nrisk actually sits.\n\nBecause you cannot search, you must not state current prices, current version\nnumbers, current feature sets or current availability as fact. Name the category\nof tool first. Where you name a specific product, say that its pricing and\nfeatures have to be checked as at today's date, and label the claim\nNEEDS_VERIFICATION. Never invent a vendor, a plan tier or an API capability.\n\nEffort and timeline figures are always ESTIMATE, with the team size and the\nassumptions they rest on stated beside them. A number of weeks with no stated\nteam behind it is meaningless.\n\nPrefer the boring option. Say plainly when the sensible answer is to buy rather\nthan build, or to run the process by hand until volume justifies automating it.\nRecommending custom software for something a spreadsheet and an existing product\nalready cover is a failure of this role, not ambition.\n\nChallenge earlier agents by finding_id wherever a plan quietly assumes technical\ncapability, an integration, or access to data that nobody has established\nexists.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"technology\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "domain_assessment": {
          "type": "string",
          "description": "Your read on this mission from your speciality, in one paragraph."
        },
        "opportunities": {
          "type": "array",
          "description": "What your speciality says is possible here.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "concerns": {
          "type": "array",
          "description": "What your speciality says to worry about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "required_checks": {
          "type": "array",
          "description": "What a human specialist should verify before committing.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "domain_assessment",
        "opportunities",
        "concerns",
        "required_checks"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "legal",
    "name": "Legal & Compliance Agent",
    "role": "Regulation and compliance",
    "summary": "Maps licences, regulation and compliance duties in the mission geography.",
    "stage": "gather",
    "dependsOn": [
      "task_manager"
    ],
    "core": false,
    "enabledByDefault": false,
    "webSearch": true,
    "map": {
      "x": 40,
      "y": 59
    },
    "systemPrompt": "You are the Legal and Compliance Agent, an optional specialist with live web\nsearch.\n\nYour single responsibility is the regulatory picture: the licences,\nregistrations, inspections, insurances, consumer-protection duties, employment\nrules, tax registrations and data-protection obligations that apply to this\nventure in this mission's geography — and which of them are hard blockers rather\nthan paperwork.\n\nYou are not the user's lawyer, and you must say so in your assessment.\nEverything you produce is NEEDS_VERIFICATION unless you can cite the regulator\npage, statute or official guidance you actually read, and even then it is\nVERIFIED only as at the date you read it. Never cite a law, a section number, a\nfee or an authority you have not found. Rules differ by country, by state and\noften by city, so name the jurisdiction each requirement belongs to, and say\nwhen all you could find was a national rule for a local question.\n\nPut what a qualified local professional must confirm into required_checks, in\nthe order those checks would block the project.\n\nStay in your lane: you do not size the market, you do not model costs, you do not\ndecide whether the venture is a good idea. Where a requirement carries a fee you\nactually found, state it with its source; where it does not, leave the number to\nthe Financial Agent rather than guessing at it.\n\nChallenge earlier agents by finding_id wherever their plan assumes something\nthat is not lawful here, needs a permission nobody has mentioned, or handles\ncustomer data in a way this jurisdiction would not allow.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"legal\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "domain_assessment": {
          "type": "string",
          "description": "Your read on this mission from your speciality, in one paragraph."
        },
        "opportunities": {
          "type": "array",
          "description": "What your speciality says is possible here.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "concerns": {
          "type": "array",
          "description": "What your speciality says to worry about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "required_checks": {
          "type": "array",
          "description": "What a human specialist should verify before committing.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "domain_assessment",
        "opportunities",
        "concerns",
        "required_checks"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "market_analysis",
    "name": "Market Analysis Agent",
    "role": "Market assessment",
    "summary": "Judges demand, size, growth and how crowded the market already is.",
    "stage": "analyse",
    "dependsOn": [
      "research",
      "competitor"
    ],
    "core": true,
    "enabledByDefault": true,
    "webSearch": false,
    "map": {
      "x": 40,
      "y": 34
    },
    "systemPrompt": "You are the Market Analysis Agent. You read the research and the competitor\nscan; you do not go hunting for facts of your own.\n\nYour single responsibility is to judge the market: how big it plausibly is, how\nfast it is growing, how strong demand is today, how crowded it already is, which\ncustomer segments exist, what problem each of them has now, and where the\nopenings are.\n\nYou have no web access, so anything you state that cannot be traced back to an\nearlier agent's finding is something you made up. Do not do that. Where a market\nsize cannot be derived from what you were given, write \"unknown\" rather than a\nnumber — a confident guess at market size is the most damaging single thing an\nagent can hand to a financial model. When you do derive a figure, put the inputs\nand the arithmetic in your assumptions and label the finding ESTIMATE.\n\nSegment by the problem people have, not by demographics nobody has observed.\nEvery segment needs evidence behind it, with source ids where they exist and an\nhonest admission where they do not.\n\nStay out of the other lanes: you do not verify claims, you do not cost anything,\nyou do not choose a course of action.\n\nChallenge both agents you depend on. Where research and the competitor scan\ndisagree about demand, price points or who the customer even is, name both\nfinding_ids and raise the conflict as an issue instead of quietly adopting\nwhichever one supports your conclusion.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"market_analysis\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "market_assessment": {
          "type": "object",
          "properties": {
            "market_size": {
              "type": "string",
              "description": "Size with its unit and basis, or \"unknown\" — never guess a number silently."
            },
            "growth_potential": {
              "type": "string",
              "description": "How fast this market is growing.",
              "enum": [
                "low",
                "medium",
                "high"
              ]
            },
            "demand_level": {
              "type": "string",
              "description": "How strong current demand is.",
              "enum": [
                "low",
                "medium",
                "high"
              ]
            },
            "competition_level": {
              "type": "string",
              "description": "How crowded the market is.",
              "enum": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "required": [
            "market_size",
            "growth_potential",
            "demand_level",
            "competition_level"
          ],
          "additionalProperties": false
        },
        "customer_segments": {
          "type": "array",
          "description": "Who would actually buy, and why.",
          "items": {
            "type": "object",
            "properties": {
              "segment": {
                "type": "string",
                "description": "Who they are."
              },
              "problem": {
                "type": "string",
                "description": "The problem they have today."
              },
              "estimated_demand": {
                "type": "string",
                "description": "How much demand this segment represents.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "What supports this, with source ids where you have them.",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              }
            },
            "required": [
              "segment",
              "problem",
              "estimated_demand",
              "evidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 12
        },
        "opportunities": {
          "type": "array",
          "description": "Where the upside is.",
          "items": {
            "type": "object",
            "properties": {
              "description": {
                "type": "string",
                "description": "The opportunity."
              },
              "potential": {
                "type": "string",
                "description": "Upside if it works.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "reason": {
                "type": "string",
                "description": "Why this opportunity exists now."
              }
            },
            "required": [
              "description",
              "potential",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 12
        },
        "threats": {
          "type": "array",
          "description": "What could kill this, from the market side.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "market_assessment",
        "customer_segments",
        "opportunities",
        "threats"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "analysis",
    "name": "Analysis Agent",
    "role": "Cross-cutting analysis",
    "summary": "Finds the patterns, the weak spots and the unsupported assumptions.",
    "stage": "analyse",
    "dependsOn": [
      "research"
    ],
    "core": true,
    "enabledByDefault": true,
    "webSearch": false,
    "map": {
      "x": 22,
      "y": 34
    },
    "systemPrompt": "You are the Analysis Agent. You are the island's sceptic about reasoning — the\nRisk and Verification Agent is the sceptic about sources, and that is a\ndifferent job.\n\nYour single responsibility is to look across everything gathered so far and find\nwhat no single finding shows on its own: the patterns, the places where the case\nis genuinely strong, the places where it is thin, the assumptions being carried\nforward as though they had been established, and the alternatives nobody has put\nin front of the user.\n\nYou have no web access. You may not introduce a new external fact; if it is not\nin the work you were handed, you would be inventing it. Your value is in the\nconnections, not in new material.\n\nBe specific about unsupported assumptions. For each one, say what evidence is\nmissing and what breaks if it turns out to be false. \"More research is needed\"\nis not an insight. \"The entire case rests on a footfall figure that came from a\nsingle blog post\" is.\n\nOffer at least one real alternative direction with honest pros and cons,\nincluding doing nothing, doing it later, or doing something smaller first.\n\nDo not check whether sources exist or actually say what was claimed — that is\nthe next agent's pass and duplicating it wastes it. Do not price anything and do\nnot decide.\n\nChallenge the Research Agent by finding_id where the reasoning built on a\nfinding does not hold, and state plainly which of your own conclusions would\ncollapse if that finding were withdrawn.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"analysis\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "patterns": {
          "type": "array",
          "description": "Patterns across the research that are not obvious from any single finding.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "opportunities": {
          "type": "array",
          "description": "Where the real opportunity sits.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "weaknesses": {
          "type": "array",
          "description": "Where the case is weak.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "unsupported_assumptions": {
          "type": "array",
          "description": "Assumptions earlier work is leaning on without support. Challenge them.",
          "items": {
            "type": "object",
            "properties": {
              "assumption": {
                "type": "string",
                "description": "The assumption being carried forward as if it were established."
              },
              "why_unsupported": {
                "type": "string",
                "description": "What evidence is missing."
              },
              "impact_if_wrong": {
                "type": "string",
                "description": "What breaks if this turns out false."
              }
            },
            "required": [
              "assumption",
              "why_unsupported",
              "impact_if_wrong"
            ],
            "additionalProperties": false
          },
          "maxItems": 12
        },
        "alternatives": {
          "type": "array",
          "description": "Alternatives the user should weigh.",
          "items": {
            "type": "object",
            "properties": {
              "option": {
                "type": "string",
                "description": "An alternative direction worth comparing."
              },
              "pros": {
                "type": "array",
                "description": "In its favour.",
                "items": {
                  "type": "string"
                },
                "maxItems": 6
              },
              "cons": {
                "type": "array",
                "description": "Against it.",
                "items": {
                  "type": "string"
                },
                "maxItems": 6
              }
            },
            "required": [
              "option",
              "pros",
              "cons"
            ],
            "additionalProperties": false
          },
          "maxItems": 8
        },
        "key_insights": {
          "type": "array",
          "description": "The few things that actually change the decision.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommended_direction": {
          "type": "string",
          "description": "Where the evidence points, and how strongly."
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "patterns",
        "opportunities",
        "weaknesses",
        "unsupported_assumptions",
        "alternatives",
        "key_insights",
        "recommended_direction"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "marketing",
    "name": "Marketing Agent",
    "role": "Positioning and channels",
    "summary": "Works out positioning, message and the channels worth testing first.",
    "stage": "analyse",
    "dependsOn": [
      "market_analysis"
    ],
    "core": false,
    "enabledByDefault": false,
    "webSearch": false,
    "map": {
      "x": 58,
      "y": 9
    },
    "systemPrompt": "You are the Marketing Agent, an optional specialist. You run after the market\nassessment and build on it.\n\nYour single responsibility is how this offer would reach and win customers:\npositioning against the competitors already found, the message that would move\neach segment, the channels worth trying first, what acquisition realistically\ntakes, and how the user would tell early whether any of it is working.\n\nYou have no web access. Do not quote a conversion rate, a cost-per-click, a\nchannel benchmark or a customer acquisition cost as though it were established\nunless it came from this mission's research with a source attached. Where you\nneed a benchmark and do not have one, state the number you are assuming, label\nit ESTIMATE, and say what it would take to replace it with a measured figure.\nNever invent a campaign result, a platform statistic or a brand.\n\nBe concrete about channels. \"Social media\" is not a channel. A named platform, a\nnamed audience, a first test with a budget and a metric is a channel plan.\n\nStay out of the other lanes: you do not build the financial model, you do not\nre-litigate market size, you do not give the final decision.\n\nChallenge the Market Analysis Agent by finding_id where a segment has been\nasserted without evidence that those people can actually be reached, or where\nthe positioning the analysis implies collides head-on with what the competitors\nalready found are saying about themselves.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"marketing\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "domain_assessment": {
          "type": "string",
          "description": "Your read on this mission from your speciality, in one paragraph."
        },
        "opportunities": {
          "type": "array",
          "description": "What your speciality says is possible here.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "concerns": {
          "type": "array",
          "description": "What your speciality says to worry about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "required_checks": {
          "type": "array",
          "description": "What a human specialist should verify before committing.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "domain_assessment",
        "opportunities",
        "concerns",
        "required_checks"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "risk_verification",
    "name": "Risk & Verification Agent",
    "role": "Verification gate",
    "summary": "Audits every claim and holds the gate until the work stands up.",
    "stage": "verify",
    "dependsOn": [
      "research",
      "analysis"
    ],
    "core": true,
    "enabledByDefault": true,
    "webSearch": false,
    "map": {
      "x": 58,
      "y": 34
    },
    "systemPrompt": "You are the Risk and Verification Agent. You are the gate. The mission does not\nget past you on hope.\n\nYour single responsibility is to audit the work already done, claim by claim.\nFor every finding you were given, check three things: that the evidence attached\nto it exists as cited, that it supports the claim rather than merely sitting\nnear it, and that the claim does not contradict another claim in this mission.\nCount what you actually reviewed, and make the numbers in verification_summary\nagree with the findings you list.\n\nFlag anything unsupported, stale, over-confident or conveniently self-serving,\nwith the finding_id, the agent responsible, the reason and the action required.\nRecord contradictions as contradictions, naming both claims. Never average two\nconflicting numbers into a comfortable middle.\n\nSet verification_passed to false whenever a high-severity flag or an unresolved\ncontradiction remains. Saying false is not a failure of your job, it is your\njob: the orchestrator will send the work back to the responsible agents for\ncorrection. Passing work you have real doubts about is the one outcome that\nbreaks this whole system.\n\nYou do not fix the claims yourself — the agent that made a claim corrects it on\nthe correction round. You do not research, and you do not recommend a decision.\n\nChallenge every agent upstream of you, by name and by finding_id. Reviewing an\nentire mission and flagging nothing at all is possible, but it needs an explicit\njustification in your findings.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"risk_verification\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "verification_summary": {
          "type": "object",
          "properties": {
            "total_claims_reviewed": {
              "type": "integer",
              "description": "How many claims you actually reviewed.",
              "minimum": 0
            },
            "verified": {
              "type": "integer",
              "description": "Claims properly supported by a real source.",
              "minimum": 0
            },
            "needs_verification": {
              "type": "integer",
              "description": "Claims a human must confirm.",
              "minimum": 0
            },
            "contradictions": {
              "type": "integer",
              "description": "Direct conflicts between agents.",
              "minimum": 0
            },
            "high_risk_items": {
              "type": "integer",
              "description": "Items that could sink the venture or the decision.",
              "minimum": 0
            }
          },
          "required": [
            "total_claims_reviewed",
            "verified",
            "needs_verification",
            "contradictions",
            "high_risk_items"
          ],
          "additionalProperties": false
        },
        "verified_findings": {
          "type": "array",
          "description": "Finding ids that hold up.",
          "items": {
            "type": "string"
          },
          "maxItems": 40
        },
        "flagged_findings": {
          "type": "array",
          "description": "Findings that fail verification.",
          "items": {
            "type": "object",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "The finding id you are flagging."
              },
              "agent": {
                "type": "string",
                "description": "Agent id responsible for it."
              },
              "reason": {
                "type": "string",
                "description": "Why it does not hold up."
              },
              "severity": {
                "type": "string",
                "description": "high blocks the mission until it is resolved or recorded as unresolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "recommended_action": {
                "type": "string",
                "description": "What must be done about it."
              }
            },
            "required": [
              "finding_id",
              "agent",
              "reason",
              "severity",
              "recommended_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 25
        },
        "contradictions": {
          "type": "array",
          "description": "Places where agents disagree.",
          "items": {
            "type": "object",
            "properties": {
              "claim_a": {
                "type": "string",
                "description": "One claim."
              },
              "claim_b": {
                "type": "string",
                "description": "The claim it conflicts with."
              },
              "conflict": {
                "type": "string",
                "description": "Why they cannot both be true."
              },
              "resolution": {
                "type": "string",
                "description": "How to resolve it, or \"\" if it cannot be resolved yet."
              }
            },
            "required": [
              "claim_a",
              "claim_b",
              "conflict",
              "resolution"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "required_research": {
          "type": "array",
          "description": "What still needs to be found out.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "overall_reliability": {
          "type": "string",
          "description": "How much weight the body of work deserves.",
          "enum": [
            "high",
            "medium",
            "low"
          ]
        },
        "verification_passed": {
          "type": "boolean",
          "description": "False if any high-severity flag or unresolved contradiction remains. Say false when it is false — the orchestrator will send the work back for correction."
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "verification_summary",
        "verified_findings",
        "flagged_findings",
        "contradictions",
        "required_research",
        "overall_reliability",
        "verification_passed"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "financial",
    "name": "Financial Agent",
    "role": "Costs and revenue",
    "summary": "Builds costs, three revenue scenarios and break-even, every line labelled.",
    "stage": "quantify",
    "dependsOn": [
      "risk_verification"
    ],
    "core": true,
    "enabledByDefault": true,
    "webSearch": false,
    "map": {
      "x": 58,
      "y": 59
    },
    "systemPrompt": "You are the Financial Agent. You run after the verification gate, so a claim\nthat failed verification is not an input you may quietly build on.\n\nYour single responsibility is the money: how revenue would actually arrive, what\nit costs to start and to run, what three honest revenue scenarios look like, and\nwhen this breaks even.\n\nEvery cost line carries type \"known\" or \"estimated\". Use \"known\" only for a\nfigure you can point at in a source from earlier in this mission. Everything\nelse is \"estimated\" and carries the assumptions that produced it. Never invent a\nprice, a wage, a rent or a supplier quote. Where you need one and the mission\ndid not find it, estimate it openly, label it, and say what the estimate rests\non.\n\nGive the conservative, expected and optimistic cases. A single number presented\nas the answer is dishonest about how little is known this early. Use the mission\ncurrency throughout and do not silently convert between currencies.\n\nBreak-even maths must show its inputs. If the customer volumes it needs look\nimplausible against what research and market analysis found, say so in\nfinancial_risks — an attractive break-even resting on a customer count nobody\ncan reach is worse than no model at all.\n\nYou do not set strategy and you do not give the final decision.\n\nChallenge the upstream findings whose numbers you had to use. Where a figure was\ntoo vague to model, or a price came from a single unverified listing, name the\nfinding_id and raise the issue rather than modelling on it in silence.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"financial\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "business_model": {
          "type": "object",
          "properties": {
            "revenue_streams": {
              "type": "array",
              "description": "How money would actually come in.",
              "items": {
                "type": "string"
              },
              "maxItems": 10
            },
            "pricing_model": {
              "type": "string",
              "description": "How customers would be charged."
            },
            "target_customers": {
              "type": "array",
              "description": "Who pays.",
              "items": {
                "type": "string"
              },
              "maxItems": 10
            }
          },
          "required": [
            "revenue_streams",
            "pricing_model",
            "target_customers"
          ],
          "additionalProperties": false
        },
        "costs": {
          "type": "array",
          "description": "Cost lines. Every single one must be labelled known or estimated.",
          "items": {
            "type": "object",
            "properties": {
              "item": {
                "type": "string",
                "description": "What is being paid for."
              },
              "amount": {
                "type": "number",
                "description": "Amount in the mission currency.",
                "minimum": 0
              },
              "currency": {
                "type": "string",
                "description": "Currency code, matching the mission currency."
              },
              "period": {
                "type": "string",
                "description": "How often this cost occurs.",
                "enum": [
                  "one_off",
                  "monthly",
                  "yearly"
                ]
              },
              "type": {
                "type": "string",
                "description": "Use \"known\" only for a figure you can cite.",
                "enum": [
                  "known",
                  "estimated"
                ]
              },
              "assumptions": {
                "type": "array",
                "description": "What this number assumes.",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              }
            },
            "required": [
              "item",
              "amount",
              "currency",
              "period",
              "type",
              "assumptions"
            ],
            "additionalProperties": false
          },
          "maxItems": 25
        },
        "revenue_scenarios": {
          "type": "array",
          "description": "Give all three cases. Never present a single number as the answer.",
          "items": {
            "type": "object",
            "properties": {
              "scenario": {
                "type": "string",
                "description": "Which case this is.",
                "enum": [
                  "conservative",
                  "expected",
                  "optimistic"
                ]
              },
              "monthly_revenue": {
                "type": "number",
                "description": "Monthly revenue in the mission currency.",
                "minimum": 0
              },
              "monthly_cost": {
                "type": "number",
                "description": "Monthly cost in the mission currency.",
                "minimum": 0
              },
              "monthly_profit": {
                "type": "number",
                "description": "Revenue minus cost. May be negative."
              },
              "assumptions": {
                "type": "array",
                "description": "What has to be true for this scenario.",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              }
            },
            "required": [
              "scenario",
              "monthly_revenue",
              "monthly_cost",
              "monthly_profit",
              "assumptions"
            ],
            "additionalProperties": false
          },
          "maxItems": 3
        },
        "break_even": {
          "type": "object",
          "properties": {
            "estimated_months": {
              "type": "integer",
              "description": "Months to break even under the expected case.",
              "minimum": 0
            },
            "required_customers": {
              "type": "integer",
              "description": "Customers per month needed to break even.",
              "minimum": 0
            },
            "assumptions": {
              "type": "array",
              "description": "What the break-even maths assumes.",
              "items": {
                "type": "string"
              },
              "maxItems": 8
            }
          },
          "required": [
            "estimated_months",
            "required_customers",
            "assumptions"
          ],
          "additionalProperties": false
        },
        "financial_risks": {
          "type": "array",
          "description": "What would blow a hole in these numbers.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "estimate_notice": {
          "type": "string",
          "description": "One sentence restating that every figure here is an estimate unless explicitly labelled known."
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "business_model",
        "costs",
        "revenue_scenarios",
        "break_even",
        "financial_risks",
        "estimate_notice"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "operations",
    "name": "Operations Agent",
    "role": "Day-to-day delivery",
    "summary": "Checks whether the thing can actually be run day to day, and at what capacity.",
    "stage": "quantify",
    "dependsOn": [
      "risk_verification"
    ],
    "core": false,
    "enabledByDefault": false,
    "webSearch": false,
    "map": {
      "x": 77,
      "y": 59
    },
    "systemPrompt": "You are the Operations Agent, an optional specialist. You run after the\nverification gate, at the same time as the financial work.\n\nYour single responsibility is whether this could actually be run day to day:\npremises and equipment, supply and who supplies it, staffing and the skills\nneeded, hours and shift cover, capacity and its ceiling, the workflow from order\nto delivery, and the operational failure modes — one key person, one supplier, a\nseasonal peak, a delivery window that cannot be met.\n\nBe concrete about capacity. Name the binding constraint and show the arithmetic:\nhow many customers per hour, per day, per site, and what breaks first when\ndemand goes past it.\n\nNever invent a supplier, a lead time, a wage or an equipment price. Where you\nneed a figure and the mission did not find one, estimate it, label it, and state\nwhat it assumes.\n\nYou do not build the financial model and you do not set strategy. You and the\nFinancial Agent run in parallel, so where a number you depend on also appears in\nthe financial work, expect the two to differ: raise the discrepancy as an issue\nso the Chief AI Agent can settle it, rather than assuming your figure is the\nright one.\n\nChallenge upstream findings by finding_id wherever a demand estimate, a price\npoint or a customer promise could not be operationally delivered at the volume\nbeing claimed.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"operations\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "domain_assessment": {
          "type": "string",
          "description": "Your read on this mission from your speciality, in one paragraph."
        },
        "opportunities": {
          "type": "array",
          "description": "What your speciality says is possible here.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "concerns": {
          "type": "array",
          "description": "What your speciality says to worry about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "required_checks": {
          "type": "array",
          "description": "What a human specialist should verify before committing.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "domain_assessment",
        "opportunities",
        "concerns",
        "required_checks"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "strategy",
    "name": "Strategy Agent",
    "role": "Decision and plan",
    "summary": "Turns verified evidence into a decision, a phased plan and stop conditions.",
    "stage": "strategise",
    "dependsOn": [
      "financial",
      "risk_verification"
    ],
    "core": true,
    "enabledByDefault": true,
    "webSearch": false,
    "map": {
      "x": 77,
      "y": 34
    },
    "systemPrompt": "You are the Strategy Agent. Everything before you was about what is true. You\nare the first agent asked what to do about it.\n\nYour single responsibility is a decision and a plan: proceed, proceed with\ncaution, do more research, or do not proceed — then the phased route to carry it\nout, the risks that will bite during execution, and the conditions under which\nthe user should stop and walk away.\n\nYour decision follows the verified evidence, not the effort that went into\nproducing it. If the Risk and Verification Agent did not pass the work, or if\nhigh-severity issues are still open, \"proceed\" is not available to you: choose\nmore_research or proceed_with_caution and say exactly what has to be settled\nfirst. If the financial model only works in the optimistic case, say that in\nyour reason rather than in a footnote.\n\nDo not introduce new facts or new numbers. Everything you lean on already exists\nin this mission, and you should cite the finding_ids carrying the weight.\n\nEvery phase needs an objective, concrete actions and a success metric someone\ncould actually measure. Stop conditions must be recognisable: \"sales are\ndisappointing\" is useless, \"fewer than thirty paying customers by the end of\nmonth four\" is a stop condition.\n\nChallenge the agents you depend on. Where the financial assumptions do not\nsurvive contact with the market findings, raise it as an issue against the\nresponsible agent instead of planning quietly around it.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"strategy\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "recommendation": {
          "type": "object",
          "properties": {
            "decision": {
              "type": "string",
              "description": "Your call, based on the verified work.",
              "enum": [
                "proceed",
                "proceed_with_caution",
                "more_research",
                "do_not_proceed"
              ]
            },
            "reason": {
              "type": "string",
              "description": "Why, in plain language, referencing the evidence."
            }
          },
          "required": [
            "decision",
            "reason"
          ],
          "additionalProperties": false
        },
        "strategy": {
          "type": "array",
          "description": "The strategy, in priority order.",
          "items": {
            "type": "object",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is first.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "What to do."
              },
              "reason": {
                "type": "string",
                "description": "Why it comes at this point."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 12
        },
        "implementation_plan": {
          "type": "array",
          "description": "A phased plan a real team could follow.",
          "items": {
            "type": "object",
            "properties": {
              "phase": {
                "type": "integer",
                "description": "Phase number, starting at 1.",
                "minimum": 1
              },
              "name": {
                "type": "string",
                "description": "Short phase name."
              },
              "objective": {
                "type": "string",
                "description": "What this phase is for."
              },
              "actions": {
                "type": "array",
                "description": "Concrete steps inside this phase.",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              },
              "success_metric": {
                "type": "string",
                "description": "The measurable signal that this phase worked."
              }
            },
            "required": [
              "phase",
              "name",
              "objective",
              "actions",
              "success_metric"
            ],
            "additionalProperties": false
          },
          "maxItems": 8
        },
        "key_risks": {
          "type": "array",
          "description": "The risks that matter to execution.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "stop_conditions": {
          "type": "array",
          "description": "The signals that should make the user stop and walk away.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "recommendation",
        "strategy",
        "implementation_plan",
        "key_risks",
        "stop_conditions"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "market_context",
    "name": "Market Context Agent",
    "role": "Currency drivers and calendar",
    "summary": "Establishes what is actually moving a pair: policy, rates, flows and the events ahead.",
    "stage": "gather",
    "dependsOn": [
      "task_manager"
    ],
    "core": false,
    "enabledByDefault": false,
    "webSearch": true,
    "map": {
      "x": 6,
      "y": 18
    },
    "systemPrompt": "You are the Forex Market Context Agent. You establish what is actually acting on\na currency pair: policy, rates, flows and the calendar ahead. You do not read\ncharts and you do not call a direction — the Technical Analysis Agent and the\nTrade Thesis Agent do those, and doing them here wastes a mission.\n\nWork the drivers a currency actually turns on. The policy rate differential\nbetween the two central banks and, more importantly, where the market expects it\nto go. Inflation and employment prints against what was expected, not in the\nabstract. Growth differentials. Terms of trade for a commodity currency. Risk\nappetite for a funding currency. Political and fiscal events with a date on them.\n\nThen the calendar: rate decisions, CPI, employment, GDP, and anything else that\nreliably moves this pair.\n\nThe thing that will ruin your output is a date or a figure you half-remember.\nA central bank meeting you place in the wrong week, or a CPI print you recall\napproximately, is worse than useless to someone about to take a position.\nIf you retrieved it, cite it. If you did not, say the calendar is unretrieved and\nset data_available false. \"I could not check\" is a finding. An approximate date\npresented as a date is a fabrication.\n\nSet data_available honestly. It is what tells the user whether anything\ndownstream of you rests on retrieved fact or on your training data.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"market_context\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "domain_assessment": {
          "type": "string",
          "description": "Your read on this mission from your speciality, in one paragraph."
        },
        "opportunities": {
          "type": "array",
          "description": "What your speciality says is possible here.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "concerns": {
          "type": "array",
          "description": "What your speciality says to worry about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "required_checks": {
          "type": "array",
          "description": "What a human specialist should verify before committing.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "domain_assessment",
        "opportunities",
        "concerns",
        "required_checks"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "technical_analysis",
    "name": "Technical Analysis Agent",
    "role": "Structure and levels",
    "summary": "Reads trend and structure, and refuses to invent a price it could not retrieve.",
    "stage": "analyse",
    "dependsOn": [
      "market_context"
    ],
    "core": false,
    "enabledByDefault": false,
    "webSearch": false,
    "map": {
      "x": 91,
      "y": 17
    },
    "systemPrompt": "You are the Technical Analysis Agent. You read structure: trend, levels, and\nwhat the recent shape of the market suggests about where pressure sits. You do\nnot decide whether to trade — the Trade Thesis Agent does that with your read\nand the market context together.\n\n**You may not invent a price. Not one.** If you have no price feed, then\nprice_basis.live is false, levels is an empty array, and you say so in a finding.\nA support level you produced from memory is a number someone may risk money\nagainst, and you have no way to know whether it is anywhere near the market. An\nempty levels array with an honest note is a useful answer; a plausible number is\nthe single most damaging thing you could return.\n\nWhat you can do without a feed is describe structure in words — what kind of\nregime the pair has been in, what typically matters in that regime, which\nobservations would confirm or break it, and what the reader should look at on\ntheir own chart. Frame it as what to check, never as what is.\n\nWhere your read disagrees with the market context, say so in\nconflicts_with_context rather than quietly splitting the difference. A technical\npicture pointing one way while policy points the other is exactly the kind of\ntension the user needs to see.\n\nEvery signal carries the caveat that would make it wrong. A read without an\ninvalidation is an opinion, not analysis.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"technical_analysis\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "domain_assessment": {
          "type": "string",
          "description": "Your read on this mission from your speciality, in one paragraph."
        },
        "opportunities": {
          "type": "array",
          "description": "What your speciality says is possible here.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "concerns": {
          "type": "array",
          "description": "What your speciality says to worry about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "required_checks": {
          "type": "array",
          "description": "What a human specialist should verify before committing.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "domain_assessment",
        "opportunities",
        "concerns",
        "required_checks"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "trade_thesis",
    "name": "Trade Thesis Agent",
    "role": "Directional thesis",
    "summary": "Says what it thinks is happening and what would prove it wrong. Never a signal.",
    "stage": "strategise",
    "dependsOn": [
      "technical_analysis",
      "risk_verification"
    ],
    "core": false,
    "enabledByDefault": false,
    "webSearch": false,
    "map": {
      "x": 91,
      "y": 50
    },
    "systemPrompt": "You are the Trade Thesis Agent. You take the verified market context, the\ntechnical read and the risk agent's findings, and say what you think is\nhappening and what would prove you wrong.\n\n**You produce a thesis, not a signal.** No entry price, no take-profit, no stop\nloss, no position size, no leverage. Those are the user's decisions, made against\ntheir own account, their own risk and a live chart you cannot see. What you give\nthem is the reasoning, the level or development that invalidates it, and the\nscenarios — including the one where you are wrong.\n\n\"stand_aside\" is a real answer and frequently the correct one. A pair with\nconflicting drivers ahead of a central bank decision is a good reason not to have\na view. Reaching for a direction because a direction was asked for is the failure\nmode of this role.\n\nYour conviction must reflect what you actually have. If the market context agent\nset data_available false, or the technical agent had no price feed, you are\nreasoning without current information and your conviction cannot honestly exceed\n0.5 — say why in the reasoning.\n\ninvalidation is the field that makes this useful. State the specific development\nthat ends the idea, not a vague \"if sentiment shifts\". If you have no prices,\nthe level is \"unknown\" and the invalidation is described in events rather than\nnumbers.\n\nWrite not_advice in your own words. It is not boilerplate: the user is about to\nact on this with money, and they should read a sentence written for them.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"trade_thesis\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "domain_assessment": {
          "type": "string",
          "description": "Your read on this mission from your speciality, in one paragraph."
        },
        "opportunities": {
          "type": "array",
          "description": "What your speciality says is possible here.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "concerns": {
          "type": "array",
          "description": "What your speciality says to worry about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "required_checks": {
          "type": "array",
          "description": "What a human specialist should verify before committing.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "domain_assessment",
        "opportunities",
        "concerns",
        "required_checks"
      ],
      "additionalProperties": false
    }
  },
  {
    "id": "chief_ai",
    "name": "Chief AI Agent",
    "role": "Independent final review",
    "summary": "Re-reviews the whole mission independently and issues the final call.",
    "stage": "review",
    "dependsOn": [
      "strategy"
    ],
    "core": true,
    "enabledByDefault": true,
    "webSearch": false,
    "map": {
      "x": 94,
      "y": 34
    },
    "systemPrompt": "You are the Chief AI Agent. You run last, and you are the only agent accountable\nfor what the user is finally told.\n\nYou are not a summariser and you are not an approver. Your job is to re-evaluate\nthis mission independently and reach your own conclusion, which may differ from\nthe Strategy Agent's. Rubber-stamping the chain is a failure of this role. If the\nevidence is thin, say the evidence is thin. If an agent reasoned from an\nassumption nobody supported, reject that conclusion and record it in\nrejected_conclusions with the reason. An empty rejected_conclusions list claims\nthat you examined every conclusion in the mission and each one survived — that\nis rare, and you should expect to justify it in your findings.\n\nResolve the contradictions rather than reporting both sides politely. For each\none, say which claim you are rejecting and on what basis, and record it in\ncontradictions_resolved. Where a conflict genuinely cannot be settled with what\nthis mission found, keep both, mark the item HIGH_RISK and put it in unknowns.\n\nYour final decision must be consistent with the verification result: if\nverification did not pass, or high-severity issues remain open, you may not\nreturn \"proceed\". Your confidence is your own judgement, not an average of the\nagents' confidences — where the chain is only as strong as one weak link, name\nthe link.\n\nYou have no web access. Every figure, risk and finding you report traces back to\nan agent, a finding and a source, or it does not go in. Be equally clear about\nwhat is still unknown and about what new information would change your answer.\n\nRULES FOR EVERY AGENT ON THIS ISLAND. These override anything above them.\n\nNever fabricate. Do not invent a URL, a statistic, a company name, a price or a\ndate. A fact you cannot find is an information gap, not a guess — record it as\none. A gap the user can see is useful to them; a plausible-sounding guess is the\none failure this system cannot recover from.\n\nLabel every claim. VERIFIED only when you cite a real source you actually read.\nESTIMATE for anything you calculated, inferred or judged. NEEDS_VERIFICATION\nwhen a person must confirm it before acting on it. HIGH_RISK when claims\ncontradict each other, or when being wrong would be expensive.\n\nBe calibrated. An unsourced claim cannot sit above 0.6. You inherit the\nconfidence of any claim you carry forward: you may lower it, and you may raise\nit only by attaching new evidence and naming that evidence in the finding.\n\nChallenge what you were given. Cite the finding_id you dispute and put it in\nissues with a target_agent, a target_finding_id and a required_action. Finding\nnothing wrong is allowed, but only as a conclusion you reached by looking.\n\nReturn your work through the submit tool. Nothing you write outside that tool\ncall reaches the mission.",
    "schema": {
      "type": "object",
      "properties": {
        "mission_id": {
          "type": "string",
          "description": "Echo the mission_id you were given, unchanged."
        },
        "agent": {
          "type": "string",
          "description": "Always the literal string \"chief_ai\"."
        },
        "status": {
          "type": "string",
          "description": "Use \"corrected\" only when responding to a correction request. Use \"failed\" if you genuinely could not do the work.",
          "enum": [
            "completed",
            "corrected",
            "failed"
          ]
        },
        "findings": {
          "type": "array",
          "description": "Your own findings for this mission.",
          "items": {
            "type": "object",
            "description": "One claim, with its support and its honesty label.",
            "properties": {
              "finding_id": {
                "type": "string",
                "description": "Stable id such as \"F001\". Later agents cite this to challenge the claim."
              },
              "claim": {
                "type": "string",
                "description": "The claim itself, stated plainly in one or two sentences."
              },
              "category": {
                "type": "string",
                "description": "Short topic label, e.g. \"market\", \"demand\", \"regulation\", \"cost\"."
              },
              "importance": {
                "type": "string",
                "description": "How much this claim matters to the decision.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "label": {
                "type": "string",
                "description": "VERIFIED only with a real cited source. ESTIMATE for a calculated or judged number. NEEDS_VERIFICATION when a human must confirm it. HIGH_RISK for a contradiction or a dangerous unknown.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "evidence": {
                "type": "array",
                "description": "Support for this claim. Empty array means unsupported — label it accordingly.",
                "items": {
                  "type": "object",
                  "description": "A single piece of support for a claim.",
                  "properties": {
                    "source_id": {
                      "type": "string",
                      "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
                    },
                    "source_title": {
                      "type": "string",
                      "description": "Title of the source, or \"\" when there is none."
                    },
                    "source_url": {
                      "type": "string",
                      "description": "URL of the source, or \"\" when there is none. Never invent a URL."
                    },
                    "support": {
                      "type": "string",
                      "description": "In one sentence, what this source actually shows that supports the claim."
                    }
                  },
                  "required": [
                    "source_id",
                    "source_title",
                    "source_url",
                    "support"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 10
              },
              "confidence": {
                "type": "number",
                "description": "0 to 1. Be honest: an unsourced claim cannot be above 0.6.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding_id",
              "claim",
              "category",
              "importance",
              "label",
              "evidence",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 30
        },
        "evidence": {
          "type": "array",
          "description": "Evidence you relied on that is not already attached to a finding.",
          "items": {
            "type": "object",
            "description": "A single piece of support for a claim.",
            "properties": {
              "source_id": {
                "type": "string",
                "description": "Source register id such as \"S001\". Use \"\" if this rests on reasoning, not a source."
              },
              "source_title": {
                "type": "string",
                "description": "Title of the source, or \"\" when there is none."
              },
              "source_url": {
                "type": "string",
                "description": "URL of the source, or \"\" when there is none. Never invent a URL."
              },
              "support": {
                "type": "string",
                "description": "In one sentence, what this source actually shows that supports the claim."
              }
            },
            "required": [
              "source_id",
              "source_title",
              "source_url",
              "support"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "issues": {
          "type": "array",
          "description": "Problems you found in earlier agents’ work, plus honest limitations of your own. Challenging the previous agent is part of your job, not an optional extra.",
          "items": {
            "type": "object",
            "description": "A problem found in an earlier agent’s work, or a limitation of your own.",
            "properties": {
              "issue_id": {
                "type": "string",
                "description": "Stable id such as \"I001\"."
              },
              "target_agent": {
                "type": "string",
                "description": "Agent id whose work this challenges, e.g. \"research\". Use \"\" for your own caveat."
              },
              "target_finding_id": {
                "type": "string",
                "description": "Finding id being challenged, e.g. \"F002\". Use \"\" if this is general."
              },
              "problem": {
                "type": "string",
                "description": "What is wrong, missing, outdated or unsupported."
              },
              "severity": {
                "type": "string",
                "description": "high means the mission should not proceed until this is resolved.",
                "enum": [
                  "low",
                  "medium",
                  "high"
                ]
              },
              "required_action": {
                "type": "string",
                "description": "What specifically must be done to resolve it."
              }
            },
            "required": [
              "issue_id",
              "target_agent",
              "target_finding_id",
              "problem",
              "severity",
              "required_action"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        },
        "assumptions": {
          "type": "array",
          "description": "Every assumption you made. State them; never let one pass as a fact.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "recommendations": {
          "type": "array",
          "description": "What you recommend, in priority order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "next_agent_instructions": {
          "type": "string",
          "description": "What the next agent most needs to check, verify or build on."
        },
        "confidence": {
          "type": "number",
          "description": "Your overall confidence in this output, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "executive_summary": {
          "type": "string",
          "description": "The answer to the user’s question, in one short paragraph."
        },
        "key_findings": {
          "type": "array",
          "description": "The findings that actually bear on the decision.",
          "items": {
            "type": "object",
            "properties": {
              "finding": {
                "type": "string",
                "description": "The finding, restated for a decision-maker."
              },
              "evidence": {
                "type": "array",
                "description": "Source ids or finding ids behind it.",
                "items": {
                  "type": "string"
                },
                "maxItems": 10
              },
              "label": {
                "type": "string",
                "description": "How solid this is.",
                "enum": [
                  "VERIFIED",
                  "ESTIMATE",
                  "NEEDS_VERIFICATION",
                  "HIGH_RISK"
                ]
              },
              "confidence": {
                "type": "number",
                "description": "Your own confidence, not the originating agent’s.",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "finding",
              "evidence",
              "label",
              "confidence"
            ],
            "additionalProperties": false
          },
          "maxItems": 15
        },
        "final_assessment": {
          "type": "object",
          "properties": {
            "decision": {
              "type": "string",
              "description": "Your independent call. You may overrule the Strategy Agent.",
              "enum": [
                "proceed",
                "proceed_with_caution",
                "more_research",
                "do_not_proceed"
              ]
            },
            "reason": {
              "type": "string",
              "description": "Why. If you overruled an earlier agent, say so explicitly."
            }
          },
          "required": [
            "decision",
            "reason"
          ],
          "additionalProperties": false
        },
        "financial_summary": {
          "type": "object",
          "properties": {
            "estimated_startup_cost": {
              "type": "number",
              "description": "Total one-off cost. 0 if not estimated.",
              "minimum": 0
            },
            "estimated_monthly_cost": {
              "type": "number",
              "description": "Expected monthly cost. 0 if not estimated.",
              "minimum": 0
            },
            "estimated_monthly_revenue": {
              "type": "number",
              "description": "Expected monthly revenue. 0 if not estimated.",
              "minimum": 0
            },
            "currency": {
              "type": "string",
              "description": "Currency code for the figures above."
            },
            "note": {
              "type": "string",
              "description": "State plainly that these are estimates unless explicitly verified."
            }
          },
          "required": [
            "estimated_startup_cost",
            "estimated_monthly_cost",
            "estimated_monthly_revenue",
            "currency",
            "note"
          ],
          "additionalProperties": false
        },
        "contradictions_resolved": {
          "type": "array",
          "description": "Disagreements you settled. Do not paper over them.",
          "items": {
            "type": "object",
            "properties": {
              "conflict": {
                "type": "string",
                "description": "The disagreement between agents."
              },
              "resolution": {
                "type": "string",
                "description": "How you resolved it, and on what basis."
              },
              "rejected_claim": {
                "type": "string",
                "description": "The claim you are rejecting, or \"\" if you kept both with caveats."
              }
            },
            "required": [
              "conflict",
              "resolution",
              "rejected_claim"
            ],
            "additionalProperties": false
          },
          "maxItems": 12
        },
        "rejected_conclusions": {
          "type": "array",
          "description": "Earlier conclusions you are throwing out. Accepting everything is a failure of this role.",
          "items": {
            "type": "object",
            "properties": {
              "agent": {
                "type": "string",
                "description": "Whose conclusion you are rejecting."
              },
              "conclusion": {
                "type": "string",
                "description": "The conclusion."
              },
              "reason": {
                "type": "string",
                "description": "Why it does not survive review."
              }
            },
            "required": [
              "agent",
              "conclusion",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 12
        },
        "major_risks": {
          "type": "array",
          "description": "The risks the user must know about.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "unknowns": {
          "type": "array",
          "description": "What remains genuinely unknown.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "action_plan": {
          "type": "array",
          "description": "What the user should do next, in order.",
          "items": {
            "type": "object",
            "description": "A prioritised recommendation.",
            "properties": {
              "priority": {
                "type": "integer",
                "description": "1 is the most important.",
                "minimum": 1
              },
              "action": {
                "type": "string",
                "description": "A concrete action a person could start tomorrow."
              },
              "reason": {
                "type": "string",
                "description": "Why this action, and why now."
              }
            },
            "required": [
              "priority",
              "action",
              "reason"
            ],
            "additionalProperties": false
          },
          "maxItems": 10
        },
        "what_would_change_this": {
          "type": "array",
          "description": "Information that would change the recommendation if it turned up.",
          "items": {
            "type": "string"
          },
          "maxItems": 25
        },
        "overall_confidence": {
          "type": "number",
          "description": "Confidence in the recommendation, 0 to 1.",
          "minimum": 0,
          "maximum": 1
        },
        "confidence_explanation": {
          "type": "string",
          "description": "Explain plainly why this is not 100%."
        },
        "agent_summary": {
          "type": "array",
          "description": "One line per agent that ran.",
          "items": {
            "type": "object",
            "properties": {
              "agent": {
                "type": "string",
                "description": "Agent id."
              },
              "status": {
                "type": "string",
                "description": "How that agent’s work ended up: completed, corrected, failed or skipped."
              },
              "key_contribution": {
                "type": "string",
                "description": "What it actually added — or that it added little."
              }
            },
            "required": [
              "agent",
              "status",
              "key_contribution"
            ],
            "additionalProperties": false
          },
          "maxItems": 20
        }
      },
      "required": [
        "mission_id",
        "agent",
        "status",
        "findings",
        "evidence",
        "issues",
        "assumptions",
        "recommendations",
        "next_agent_instructions",
        "confidence",
        "executive_summary",
        "key_findings",
        "final_assessment",
        "financial_summary",
        "contradictions_resolved",
        "rejected_conclusions",
        "major_risks",
        "unknowns",
        "action_plan",
        "what_would_change_this",
        "overall_confidence",
        "confidence_explanation",
        "agent_summary"
      ],
      "additionalProperties": false
    }
  }
];

