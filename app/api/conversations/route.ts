import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import {
  createConversation,
  getConversations,
} from "@/services/conversation.service";
import {
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const authUser = authenticate(req);

    const body = await req.json();

    const conversation = await createConversation(
      body,
      authUser.id,
      authUser.companyId
    );

    return NextResponse.json(conversation, {
      status: 201,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        {
          status: 401,
        }
      );
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        {
          status: 403,
        }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Internal Server Error",
      },
      {
        status: 500,
      }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const authUser = authenticate(req);

    const conversations = await getConversations(
      authUser.companyId
    );

    return NextResponse.json({
      success: true,
      conversations,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        {
          status: 401,
        }
      );
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        {
          status: 403,
        }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Internal Server Error",
      },
      {
        status: 500,
      }
    );
  }
}